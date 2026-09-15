"""
SAM 3 concrete implementation of SegmentationProvider.

Uses Meta's own `sam3` package (facebookresearch/sam3) rather than the
community `transformers` SAM 3 integration used previously — that integration
could not load the SAM 3.1 checkpoint (different internal module naming) and
this migration standardizes on Meta's officially maintained loading path for
both the base SAM 3 checkpoint and any future SAM 3.1 upgrade.

Install with:
  pip install git+https://github.com/facebookresearch/sam3.git
  pip install einops triton-windows pycocotools
(einops/triton-windows/pycocotools are transitive runtime deps the package's
own install metadata does not declare; triton-windows is a community-built
Windows-compatible drop-in for the Linux/CUDA-only `triton` package.)

Two APIs from the package cover every prompt type this app needs, both fed by
a single `Sam3Processor.set_image()` call per session:
  - Sam3Processor.set_text_prompt() / .add_geometric_prompt() — PCS (concept)
    prompts: free text, and positive/negative boxes for exemplar-style or
    exclusion-style prompting.
  - Sam3Image.predict_inst() (on the model returned by build_sam3_image_model
    with enable_inst_interactivity=True) — SAM 1/2-style single-instance
    prompts: point clicks and/or a box, reusing the same inference_state.

Configuration (via ai-config.json):
  segmentation.model_checkpoint   — path to the sam3.pt checkpoint file
  segmentation.device             — "auto" | "cuda" | "cpu"
  segmentation.max_cached_sessions — int (default 5)
"""

import base64
import io
import logging
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from facelib.segmentation_provider import SegmentationProvider

logger = logging.getLogger("smart-photo-ai")

_INSTALL_CMD = (
    "pip install git+https://github.com/facebookresearch/sam3.git "
    "einops triton-windows pycocotools"
)


class Sam3PackageProvider(SegmentationProvider):
    """
    SAM 3 segmentation provider backed by Meta's official `sam3` package.

    Lazily loads the SAM 3 image model (detector + SAM1-task interactive
    predictor sharing one vision backbone) on first prediction call.
    Maintains an in-memory session cache (PIL image + precomputed inference
    state) with LRU eviction. Degrades gracefully when the `sam3` package
    is not installed.
    """

    def __init__(
        self,
        model_checkpoint: str = "models/sam3.pt",
        device: str = "auto",
        max_cached_sessions: int = 5,
    ) -> None:
        self._checkpoint = model_checkpoint
        self._device_pref = device
        self._max_sessions = max_cached_sessions

        self._model: Any = None
        self._processor: Any = None

        self._device: str = "cpu"
        self._initialized: bool = False
        self._failed: bool = False
        self._fail_reason: str = ""

        # session_id → {"image": PIL.Image, "state": dict, "created_at": float}
        self._sessions: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # SegmentationProvider interface
    # ------------------------------------------------------------------

    def initialize(self) -> None:
        """Load the SAM 3 image model from the local checkpoint."""
        if self._initialized or self._failed:
            return

        try:
            import sam3  # noqa: F401
            from sam3.model_builder import build_sam3_image_model
            from sam3.model.sam3_image_processor import Sam3Processor
        except ImportError as e:
            self._failed = True
            self._fail_reason = f"SAM 3 package not installed ({e}). Install with: {_INSTALL_CMD}"
            logger.warning("SAM 3 unavailable — sam3 package not found")
            return

        self._device = self._resolve_device()
        from facelib.utils import resolve_model_path
        checkpoint_path = Path(resolve_model_path(self._checkpoint)).resolve()

        if not checkpoint_path.is_file():
            self._failed = True
            self._fail_reason = f"Checkpoint not found: {checkpoint_path}"
            logger.error("SAM 3 checkpoint missing at %s", checkpoint_path)
            return

        logger.info("Loading SAM 3 (sam3 package) from %s on %s", checkpoint_path, self._device)

        try:
            self._model = build_sam3_image_model(
                device=self._device,
                checkpoint_path=str(checkpoint_path),
                load_from_HF=False,
                enable_inst_interactivity=True,
            )
            self._processor = Sam3Processor(self._model, device=self._device)
        except Exception as e:
            self._failed = True
            self._fail_reason = str(e)
            logger.error("SAM 3 model load failed: %s", e)
            return

        self._initialized = True
        logger.info("SAM 3 loaded successfully on %s", self._device)

    def set_image(self, image_path: str) -> str:
        """Load an image into a session and return the session_id."""
        self._ensure_initialized()
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"Image not found: {image_path}")

        image = Image.open(path).convert("RGB")
        session_id = str(uuid.uuid4())

        if len(self._sessions) >= self._max_sessions:
            self._evict_oldest()

        state = self._processor.set_image(image) if not self._failed else None

        self._sessions[session_id] = {
            "image": image,
            "state": state,
            "created_at": time.monotonic(),
        }
        logger.info("Image session created session_id=%s size=%s", session_id, image.size)
        return session_id

    def get_session_image(self, session_id: str) -> Image.Image:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return session["image"]

    def predict_from_text(
        self,
        session_id: str,
        text: str,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> dict[str, Any]:
        """Run PCS segmentation using a text prompt (all matching instances)."""
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        state = self._get_session(session_id)["state"]
        self._processor.reset_all_prompts(state)
        self._processor.confidence_threshold = threshold

        try:
            state = self._processor.set_text_prompt(prompt=text, state=state)
            result = self._format_pcs_output(state, mask_threshold)
            logger.info(
                "predict_from_text: text=%r threshold=%.2f found %d mask(s)",
                text, threshold, len(result["masks"]),
            )
            return result
        except Exception as e:
            logger.error("predict_from_text failed: %s", e)
            return {"masks": []}

    def predict_from_text_with_exclusions(
        self,
        session_id: str,
        text: str,
        neg_boxes: list[list[int]],
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> dict[str, Any]:
        """PCS segmentation with a text prompt and negative bounding-box exclusions."""
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        session = self._get_session(session_id)
        state = session["state"]
        img_w, img_h = session["image"].size
        self._processor.reset_all_prompts(state)
        self._processor.confidence_threshold = threshold

        try:
            state = self._processor.set_text_prompt(prompt=text, state=state)
            for neg_box in neg_boxes:
                box_norm = self._xyxy_to_norm_cxcywh(neg_box, img_w, img_h)
                state = self._processor.add_geometric_prompt(box=box_norm, label=False, state=state)
            result = self._format_pcs_output(state, mask_threshold)
            logger.info(
                "predict_from_text_with_exclusions: text=%r neg_boxes=%d found %d mask(s)",
                text, len(neg_boxes), len(result["masks"]),
            )
            return result
        except Exception as e:
            logger.error("predict_from_text_with_exclusions failed: %s", e)
            return {"masks": []}

    def predict_from_exemplar(
        self,
        session_id: str,
        ref_box: list[int],
        neg_boxes: list[list[int]] | None = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> dict[str, Any]:
        """
        PCS segmentation using an image exemplar (visual reference box).

        No text prompt is set, so Sam3Processor.add_geometric_prompt() falls
        back to a dummy "visual" text prompt internally, asking SAM 3 to find
        all instances of the same visual concept as the positive box.
        """
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        session = self._get_session(session_id)
        state = session["state"]
        img_w, img_h = session["image"].size
        negs = neg_boxes or []
        self._processor.reset_all_prompts(state)
        self._processor.confidence_threshold = threshold

        try:
            ref_norm = self._xyxy_to_norm_cxcywh(ref_box, img_w, img_h)
            state = self._processor.add_geometric_prompt(box=ref_norm, label=True, state=state)
            for neg_box in negs:
                neg_norm = self._xyxy_to_norm_cxcywh(neg_box, img_w, img_h)
                state = self._processor.add_geometric_prompt(box=neg_norm, label=False, state=state)
            result = self._format_pcs_output(state, mask_threshold)
            logger.info(
                "predict_from_exemplar: ref_box=%s neg_boxes=%d found %d mask(s)",
                ref_box, len(negs), len(result["masks"]),
            )
            return result
        except Exception as e:
            logger.error("predict_from_exemplar failed: %s", e)
            return {"masks": []}

    def predict_from_box(self, session_id: str, box: list[int]) -> dict[str, Any]:
        """Run SAM1-task instance segmentation using a bounding-box prompt [x1, y1, x2, y2]."""
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        state = self._get_session(session_id)["state"]

        try:
            box_np = np.array(box, dtype=np.float32)[None, :]
            masks, scores, _ = self._model.predict_inst(
                state, point_coords=None, point_labels=None, box=box_np, multimask_output=False
            )
            return self._format_inst_output(masks, scores)
        except Exception as e:
            logger.error("predict_from_box failed: %s", e)
            return {"masks": []}

    def predict_from_points(
        self,
        session_id: str,
        points: list[list[int]],
        labels: list[int],
    ) -> dict[str, Any]:
        """Run SAM1-task instance segmentation using click-point prompts."""
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        state = self._get_session(session_id)["state"]

        try:
            point_coords = np.array(points, dtype=np.float32)
            point_labels = np.array(labels, dtype=np.int64)
            masks, scores, _ = self._model.predict_inst(
                state, point_coords=point_coords, point_labels=point_labels, multimask_output=False
            )
            return self._format_inst_output(masks, scores)
        except Exception as e:
            logger.error("predict_from_points failed: %s", e)
            return {"masks": []}

    def predict_from_box_and_points(
        self,
        session_id: str,
        box: list[int],
        points: list[list[int]],
        labels: list[int],
    ) -> dict[str, Any]:
        """
        Run SAM1-task instance segmentation using both a box and click points
        in a single native call — predict_inst() accepts both prompt types
        together directly, so no ROI-constraint fallback is needed here.
        """
        self._ensure_initialized()
        if self._failed:
            return {"masks": [], "error": self._fail_reason}

        state = self._get_session(session_id)["state"]

        try:
            box_np = np.array(box, dtype=np.float32)
            point_coords = np.array(points, dtype=np.float32)
            point_labels = np.array(labels, dtype=np.int64)
            masks, scores, _ = self._model.predict_inst(
                state,
                point_coords=point_coords,
                point_labels=point_labels,
                box=box_np,
                multimask_output=False,
            )
            result = self._format_inst_output(masks, scores)
            logger.info(
                "predict_from_box_and_points: %d mask(s)", len(result["masks"]),
            )
            return result
        except Exception as e:
            logger.error("predict_from_box_and_points failed: %s", e)
            return {"masks": []}

    def get_capabilities(self) -> dict[str, Any]:
        import importlib.util as _ilu

        from facelib.utils import resolve_model_path
        sam3_ok = _ilu.find_spec("sam3") is not None
        checkpoint_path = Path(resolve_model_path(self._checkpoint)).resolve()
        file_ready = checkpoint_path.is_file() and checkpoint_path.suffix in {".pt", ".pth"}

        model_ready = sam3_ok and file_ready and not self._failed
        result: dict[str, Any] = {
            "provider": "sam3",
            "model_ready": model_ready,
            "model_file_present": file_ready,
            "transformers_compatible": sam3_ok,
            "text_prompts": True,
            "exemplar_prompts": True,
            "video": False,
            "checkpoint": str(checkpoint_path),
        }
        if self._failed:
            result["error"] = self._fail_reason
        if not sam3_ok:
            result["install_hint"] = _INSTALL_CMD
        return result

    def cleanup(self) -> None:
        self._sessions.clear()
        self._model = None
        self._processor = None
        self._initialized = False
        self._failed = False
        logger.info("SAM 3 provider cleaned up")

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

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

    def _xyxy_to_norm_cxcywh(self, box_xyxy: list[int], img_w: int, img_h: int) -> list[float]:
        x1, y1, x2, y2 = box_xyxy
        cx = (x1 + x2) / 2 / img_w
        cy = (y1 + y2) / 2 / img_h
        bw = (x2 - x1) / img_w
        bh = (y2 - y1) / img_h
        return [cx, cy, bw, bh]

    def _mask_to_b64(self, mask_np: np.ndarray) -> str:
        """Convert a boolean numpy mask [H, W] → base64-encoded grayscale PNG."""
        mask_img = Image.fromarray((mask_np.astype(np.uint8) * 255), mode="L")
        buf = io.BytesIO()
        mask_img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    def _format_pcs_output(self, state: dict, mask_threshold: float) -> dict[str, Any]:
        """Convert Sam3Processor state (masks_logits/scores) → {masks: [...]}."""
        masks_logits = state.get("masks_logits")
        scores = state.get("scores")
        if masks_logits is None or len(scores) == 0:
            return {"masks": []}

        masks_out = []
        probs = masks_logits.squeeze(1)  # N x H x W
        for i in range(probs.shape[0]):
            mask_np = (probs[i].detach().cpu().numpy() > mask_threshold)
            masks_out.append({
                "mask_b64": self._mask_to_b64(mask_np),
                "score": float(scores[i].item()),
                "area": int(mask_np.sum()),
            })
        return {"masks": masks_out}

    def _format_inst_output(self, masks: np.ndarray, scores: np.ndarray) -> dict[str, Any]:
        """Convert predict_inst() output (CxHxW bool masks, C scores) → {masks: [...]}."""
        masks_out = []
        for i in range(masks.shape[0]):
            mask_np = masks[i].astype(bool)
            masks_out.append({
                "mask_b64": self._mask_to_b64(mask_np),
                "score": float(scores[i]),
                "area": int(mask_np.sum()),
            })
        return {"masks": masks_out}
