"""
SAM 3 concrete implementation of SegmentationProvider.

Uses the official SAM 3 classes from transformers 5.0.0.dev0+:
  - Sam3Model + Sam3Processor             → box-prompt segmentation
  - Sam3TrackerModel + Sam3TrackerProcessor → point-prompt segmentation

Requires transformers installed from git:
  pip install git+https://github.com/huggingface/transformers.git

If the classes are not importable the provider marks itself unavailable and
all prediction methods return empty results — the UI shows an install prompt.

Configuration (via ai-config.json):
  segmentation.model_checkpoint   — path to weights file or HF repo dir
  segmentation.device             — "auto" | "cuda" | "cpu"
  segmentation.max_cached_sessions — int (default 5)
"""

import base64
import io
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from facelib.segmentation_provider import SegmentationProvider

logger = logging.getLogger("smart-photo-ai")

_INSTALL_CMD = "pip install git+https://github.com/huggingface/transformers.git"


class Sam3Provider(SegmentationProvider):
    """
    SAM 3 segmentation provider.

    Lazily loads Sam3Model + Sam3TrackerModel on first prediction call.
    Maintains an in-memory session cache (PIL Images) with LRU eviction.
    Degrades gracefully when transformers < 5.0.dev is installed.
    """

    def __init__(
        self,
        model_checkpoint: str = "models/sam3_model.safetensors",
        device: str = "auto",
        max_cached_sessions: int = 5,
    ) -> None:
        self._checkpoint = model_checkpoint
        self._device_pref = device
        self._max_sessions = max_cached_sessions

        # Sam3Model + Sam3Processor for box prompts
        self._model: Any = None
        self._processor: Any = None
        # Sam3TrackerModel + Sam3TrackerProcessor for point prompts
        self._tracker: Any = None
        self._tracker_processor: Any = None

        self._device: str = "cpu"
        self._initialized: bool = False
        self._failed: bool = False
        self._fail_reason: str = ""

        # session_id → {"image": PIL.Image, "created_at": float}
        self._sessions: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # SegmentationProvider interface
    # ------------------------------------------------------------------

    def initialize(self) -> None:
        """Load SAM 3 model weights from the local checkpoint."""
        if self._initialized or self._failed:
            return

        # Fail fast if the SAM 3 classes aren't in this transformers build
        try:
            from transformers import (  # noqa: F401
                Sam3Model,
                Sam3Processor,
                Sam3TrackerModel,
                Sam3TrackerProcessor,
            )
        except ImportError:
            self._failed = True
            self._fail_reason = (
                f"SAM 3 requires transformers 5.0 dev. Install with: {_INSTALL_CMD}"
            )
            logger.warning("SAM 3 unavailable — transformers SAM 3 classes not found")
            return

        self._device = self._resolve_device()
        checkpoint_path = Path(self._checkpoint).resolve()

        # If checkpoint is a bare weights file, load from its parent directory.
        # from_pretrained expects model.safetensors; copy if needed.
        if checkpoint_path.is_file():
            pretrained_src = checkpoint_path.parent
            std_weights = pretrained_src / "model.safetensors"
            if not std_weights.exists():
                logger.info(
                    "Copying %s → model.safetensors so from_pretrained can locate it",
                    checkpoint_path.name,
                )
                shutil.copy2(checkpoint_path, std_weights)
        else:
            pretrained_src = checkpoint_path

        logger.info("Loading SAM 3 from %s on %s", pretrained_src, self._device)

        try:
            from transformers import (
                Sam3Model,
                Sam3Processor,
                Sam3TrackerModel,
                Sam3TrackerProcessor,
            )

            self._processor = Sam3Processor.from_pretrained(str(pretrained_src))
            self._model = Sam3Model.from_pretrained(str(pretrained_src)).to(self._device)
            self._model.eval()

            self._tracker_processor = Sam3TrackerProcessor.from_pretrained(str(pretrained_src))
            # The sam3_video checkpoint stores tracker weights under "tracker_model.*"
            # but Sam3TrackerModel expects them at the root level. Remap manually.
            self._tracker = self._load_tracker(pretrained_src, Sam3TrackerModel)
            self._tracker = self._tracker.to(self._device)
            self._tracker.eval()
        except Exception as e:
            self._failed = True
            self._fail_reason = str(e)
            logger.error("SAM 3 model load failed: %s", e)
            return

        self._initialized = True
        logger.info("SAM 3 loaded successfully on %s", self._device)

    def set_image(self, image_path: str) -> str:
        """Load an image into a session and return the session_id."""
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"Image not found: {image_path}")

        image = Image.open(path).convert("RGB")
        session_id = str(uuid.uuid4())

        if len(self._sessions) >= self._max_sessions:
            self._evict_oldest()

        self._sessions[session_id] = {
            "image": image,
            "created_at": time.monotonic(),
        }
        logger.info("Image session created session_id=%s size=%s", session_id, image.size)
        return session_id

    def get_session_image(self, session_id: str) -> Image.Image:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return session["image"]

    def predict_from_text(self, session_id: str, text: str) -> dict[str, Any]:
        """SAM 3 does not support text-only prompts — returns empty masks."""
        return {
            "masks": [],
            "info": "Text prompts are not supported. Use box or point mode.",
        }

    def predict_from_box(self, session_id: str, box: list[int]) -> dict[str, Any]:
        """Run segmentation using a bounding-box prompt [x1, y1, x2, y2]."""
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        image = self._get_session(session_id)["image"]

        import torch

        # input_boxes: [image_level, box_level, coordinates] = (1, 1, 4)
        inputs = self._processor(
            images=image,
            input_boxes=[[box]],
            input_boxes_labels=[[1]],
            return_tensors="pt",
        ).to(self._device)

        with torch.no_grad():
            outputs = self._model(**inputs)

        original_sizes = inputs.get("original_sizes")
        target_sizes = (
            original_sizes.tolist()
            if original_sizes is not None
            else [[image.height, image.width]]
        )

        try:
            results = self._processor.post_process_instance_segmentation(
                outputs,
                threshold=0.5,
                mask_threshold=0.5,
                target_sizes=target_sizes,
            )[0]
            return self._format_box_output(results)
        except Exception as e:
            logger.error("post_process_instance_segmentation failed: %s", e)
            return {"masks": []}

    def predict_from_points(
        self,
        session_id: str,
        points: list[list[int]],
        labels: list[int],
    ) -> dict[str, Any]:
        """
        Run segmentation using click-point prompts.

        Attempts Sam3TrackerModel first.  If it fails (e.g. due to partial
        weight loading from the sam3_video checkpoint), falls back to deriving
        a bounding box from the positive/negative points and routing through
        the fully-loaded Sam3Model.
        """
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        image = self._get_session(session_id)["image"]

        import torch

        inputs = self._tracker_processor(
            images=image,
            input_points=[[points]],
            input_labels=[[labels]],
            return_tensors="pt",
        ).to(self._device)

        with torch.no_grad():
            outputs = self._tracker(**inputs)

        original_sizes = inputs.get("original_sizes")
        sizes_list = (
            [tuple(s.tolist()) for s in original_sizes]
            if original_sizes is not None
            else [(image.height, image.width)]
        )

        try:
            masks = self._tracker_processor.post_process_masks(
                outputs.pred_masks.cpu(),
                sizes_list,
            )[0]
            result = self._format_point_output(masks)
            if result["masks"]:
                return result
            raise ValueError("tracker returned no masks")
        except Exception as e:
            logger.warning(
                "Sam3TrackerModel post-process failed (%s) — falling back to box-from-points", e
            )
            return self._predict_points_via_box(session_id, points, labels, image)

    def _predict_points_via_box(
        self,
        session_id: str,
        points: list[list[int]],
        labels: list[int],
        image: Any,
    ) -> dict[str, Any]:
        """
        Fallback: derive a bounding box from clicked points and use Sam3Model.

        Positive points (label=1) expand the box; negative points (label=0)
        shrink it from whichever edge they are closest to.
        """
        positive = [p for p, l in zip(points, labels) if l == 1]
        negative = [p for p, l in zip(points, labels) if l == 0]

        if not positive:
            return {"masks": []}

        xs = [p[0] for p in positive]
        ys = [p[1] for p in positive]
        pad = max(20, min(image.width, image.height) // 20)

        x1 = max(0, min(xs) - pad)
        y1 = max(0, min(ys) - pad)
        x2 = min(image.width, max(xs) + pad)
        y2 = min(image.height, max(ys) + pad)

        # Shrink edges toward negative points
        for nx, ny in negative:
            if nx < (x1 + x2) / 2:
                x1 = max(x1, nx)
            else:
                x2 = min(x2, nx)
            if ny < (y1 + y2) / 2:
                y1 = max(y1, ny)
            else:
                y2 = min(y2, ny)

        box = [int(x1), int(y1), int(x2), int(y2)]
        logger.info("Points fallback: derived box %s from %d point(s)", box, len(points))
        return self.predict_from_box(session_id, box)

    def predict_from_box_and_points(
        self,
        session_id: str,
        box: list[int],
        points: list[list[int]],
        labels: list[int],
    ) -> dict[str, Any]:
        """
        Run segmentation using both a bounding box and click-point prompts.

        Strategy: run the tracker-based point segmentation first (which correctly
        handles point prompts), then apply the box as a hard ROI constraint —
        zeroing out any mask pixels that fall outside the box bounds.

        This avoids trying to pass both input types to Sam3Processor at once
        (it only supports box prompts and silently ignores point inputs).
        Falls back to box-only if the point segmentation returns no masks.
        """
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        # Run point-based segmentation via the tracker
        points_result = self.predict_from_points(session_id, points, labels)

        if not points_result.get("masks"):
            logger.info(
                "predict_from_box_and_points: tracker returned no masks — falling back to box-only"
            )
            return self.predict_from_box(session_id, box)

        # Apply box as a hard spatial constraint: zero mask pixels outside the box
        x1, y1, x2, y2 = int(box[0]), int(box[1]), int(box[2]), int(box[3])
        constrained: list[dict] = []

        for entry in points_result["masks"]:
            mask_bytes = base64.b64decode(entry["mask_b64"])
            mask_np = np.array(Image.open(io.BytesIO(mask_bytes)).convert("L")) > 128

            roi = np.zeros_like(mask_np)
            roi[y1:y2, x1:x2] = mask_np[y1:y2, x1:x2]

            area = int(roi.sum())
            if area > 0:
                constrained.append({
                    "mask_b64": self._mask_to_b64(roi),
                    "score": entry["score"],
                    "area": area,
                })

        if not constrained:
            logger.info(
                "predict_from_box_and_points: ROI constraint removed all mask pixels — falling back to box-only"
            )
            return self.predict_from_box(session_id, box)

        logger.info(
            "predict_from_box_and_points: %d mask(s) after box ROI constraint", len(constrained)
        )
        return {"masks": constrained}

    def get_capabilities(self) -> dict[str, Any]:
        # Check SAM 3 import availability without triggering a full model load
        try:
            from transformers import Sam3Model  # noqa: F401
            transformers_ok = True
        except ImportError:
            transformers_ok = False

        checkpoint_path = Path(self._checkpoint).resolve()
        file_ready = (
            (checkpoint_path.is_dir() and (checkpoint_path / "config.json").exists())
            or checkpoint_path.is_file()
            and checkpoint_path.suffix in {".safetensors", ".bin", ".pt", ".pth"}
        )

        model_ready = transformers_ok and file_ready and not self._failed
        result: dict[str, Any] = {
            "provider": "sam3",
            "model_ready": model_ready,
            "model_file_present": file_ready,
            "transformers_compatible": transformers_ok,
            "text_prompts": False,
            "video": False,
            "checkpoint": str(checkpoint_path),
        }
        if self._failed:
            result["error"] = self._fail_reason
        if not transformers_ok:
            result["install_hint"] = _INSTALL_CMD
        return result

    def cleanup(self) -> None:
        self._sessions.clear()
        self._model = None
        self._tracker = None
        self._processor = None
        self._tracker_processor = None
        self._initialized = False
        self._failed = False
        logger.info("SAM 3 provider cleaned up")

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _load_tracker(self, pretrained_src: Path, Sam3TrackerModel: Any) -> Any:
        """
        Load Sam3TrackerModel with correctly remapped weights.

        The sam3_video checkpoint has two namespaces relevant to the tracker:
          - "tracker_model.*"  — tracker-specific layers (mask decoder, memory, etc.)
          - root-level keys    — shared components like the vision encoder

        Sam3TrackerModel expects both at root level.  We:
          1. Strip "tracker_model." prefix from tracker-specific keys
          2. Include all root-level keys that don't belong to another sub-model
             (i.e. not under "detector_model.*" or "tracker_model.*")
        """
        from safetensors.torch import load_file as load_safetensors

        weights_path = pretrained_src / "model.safetensors"
        full_state = load_safetensors(str(weights_path))

        # Sub-model prefixes whose keys belong exclusively to other models
        other_model_prefixes = ("detector_model.", "tracker_model.")

        tracker_state: dict = {}
        for k, v in full_state.items():
            if k.startswith("tracker_model."):
                # Strip prefix so key lands at root level where tracker expects it
                tracker_state[k[len("tracker_model."):]] = v
            elif not any(k.startswith(p) for p in other_model_prefixes):
                # Root-level shared weights (vision encoder, positional embeddings, etc.)
                tracker_state[k] = v

        tracker = Sam3TrackerModel.from_pretrained(str(pretrained_src))

        missing, unexpected = tracker.load_state_dict(tracker_state, strict=False)
        loaded = len(tracker_state) - len(unexpected)
        logger.info(
            "Tracker weights loaded: %d matched, %d missing, %d unexpected",
            loaded, len(missing), len(unexpected),
        )
        if missing:
            logger.debug("Tracker missing keys (first 10): %s", missing[:10])

        return tracker

    def _resolve_device(self) -> str:
        if self._device_pref != "auto":
            return self._device_pref
        try:
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            return "cpu"

    def _ensure_initialized(self) -> None:
        if not self._initialized and not self._failed:
            self.initialize()

    def _get_session(self, session_id: str) -> dict[str, Any]:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return session

    def _evict_oldest(self) -> None:
        if not self._sessions:
            return
        oldest_id = min(self._sessions, key=lambda k: self._sessions[k]["created_at"])
        del self._sessions[oldest_id]
        logger.info("Session evicted (cache full) session_id=%s", oldest_id)

    def _mask_to_b64(self, mask_np: np.ndarray) -> str:
        """Convert a boolean numpy mask [H, W] → base64-encoded grayscale PNG."""
        mask_img = Image.fromarray((mask_np.astype(np.uint8) * 255), mode="L")
        buf = io.BytesIO()
        mask_img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    def _format_box_output(self, results: Any) -> dict[str, Any]:
        """
        Convert Sam3Model post_process_instance_segmentation result
        → {masks: [{mask_b64, score, area}]}.
        """
        masks = getattr(results, "masks", None) or results.get("masks", [])
        scores = getattr(results, "scores", None) or results.get("scores", [])

        masks_out = []
        for i, mask in enumerate(masks):
            mask_np = mask.cpu().numpy() if hasattr(mask, "numpy") else np.array(mask)
            score = float(scores[i].item()) if i < len(scores) else 1.0
            masks_out.append({
                "mask_b64": self._mask_to_b64(mask_np.astype(bool)),
                "score": score,
                "area": int(mask_np.sum()),
            })

        return {"masks": masks_out}

    def _format_point_output(self, masks: Any) -> dict[str, Any]:
        """
        Convert Sam3TrackerModel post_process_masks output
        → {masks: [{mask_b64, score, area}]}.
        """
        import torch
        if isinstance(masks, torch.Tensor):
            mask_list = [masks[i] for i in range(masks.shape[0])]
        elif isinstance(masks, (list, tuple)):
            mask_list = list(masks)
        else:
            return {"masks": []}

        masks_out = []
        for mask in mask_list:
            mask_np = mask.cpu().numpy() if hasattr(mask, "numpy") else np.array(mask)
            masks_out.append({
                "mask_b64": self._mask_to_b64(mask_np.astype(bool)),
                "score": 1.0,
                "area": int(mask_np.sum()),
            })

        return {"masks": masks_out}
