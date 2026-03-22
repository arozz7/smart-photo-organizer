"""
Segmentation Routes — SAM 3 creative tools.

Endpoints:
  GET  /capabilities              — model info and readiness check
  POST /set-image                 — load image into a named session
  POST /predict                   — run segmentation (text / box / points)
  POST /apply/background-remove   — transparent background using mask
  POST /apply/isolate             — crop and extract masked subject
  POST /apply/blur                — Gaussian blur over masked region
  POST /apply/enhance             — sharpening over masked region
"""

import logging
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException

from facelib.segmentation_provider import SegmentationProvider
from facelib.segmentation_ops import (
    decode_mask,
    encode_image,
    apply_background_remove,
    apply_isolate,
    apply_blur,
    apply_enhance,
)

logger = logging.getLogger("smart-photo-ai")
router = APIRouter()

_ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp",
    ".tiff", ".tif", ".webp", ".heic", ".heif",
}

# Module-level singleton — overridden in tests via app.dependency_overrides.
_provider_instance: Optional[SegmentationProvider] = None


def get_provider() -> SegmentationProvider:
    """FastAPI dependency — returns the singleton SAM 3 provider."""
    global _provider_instance
    if _provider_instance is None:
        from facelib.sam3_provider import Sam3Provider
        from config import AI_CONFIG

        cfg = AI_CONFIG.get("segmentation", {})
        _provider_instance = Sam3Provider(
            model_checkpoint=cfg.get("model_checkpoint", "models/sam3"),
            device=cfg.get("device", "auto"),
            max_cached_sessions=cfg.get("max_cached_sessions", 5),
        )
    return _provider_instance


# ------------------------------------------------------------------
# Request / response models
# ------------------------------------------------------------------

class SetImageRequest(BaseModel):
    imagePath: str


class PredictRequest(BaseModel):
    session_id: str
    text: Optional[str] = None
    box: Optional[list[int]] = None           # [x1, y1, x2, y2]
    points: Optional[list[list[int]]] = None  # [[x, y], ...]
    point_labels: Optional[list[int]] = None  # 1 = positive, 0 = negative


class ApplyRequest(BaseModel):
    session_id: str
    mask_b64: str


class BlurRequest(ApplyRequest):
    radius: int = 15


class EnhanceRequest(ApplyRequest):
    strength: float = 0.5


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _validate_image_path(image_path: str) -> str:
    """Validate extension and existence; raise HTTPException on failure."""
    resolved = Path(image_path).resolve()
    if resolved.suffix.lower() not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {resolved.suffix}",
        )
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return str(resolved)


def _run_apply(
    provider: SegmentationProvider,
    session_id: str,
    mask_b64: str,
    apply_fn: Any,
) -> dict[str, str]:
    """Shared logic for all /apply/* endpoints."""
    try:
        image = provider.get_session_image(session_id)
        mask = decode_mask(mask_b64)
        result = apply_fn(image, mask)
        return {"session_id": session_id, "result_b64": encode_image(result)}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as e:
        logger.error({"error": str(e)}, "apply operation failed")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@router.get("/capabilities")
async def capabilities(
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, Any]:
    """Return model name, checkpoint readiness, and supported feature flags."""
    return provider.get_capabilities()


@router.post("/set-image")
async def set_image(
    request: SetImageRequest,
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, str]:
    """
    Load an image into a session.

    Returns a session_id that must be passed to /predict and /apply/* calls.
    Sessions are evicted LRU-style when max_cached_sessions is reached.
    """
    validated_path = _validate_image_path(request.imagePath)
    try:
        session_id = provider.set_image(validated_path)
        return {"session_id": session_id}
    except Exception as e:
        logger.error({"error": str(e)}, "set_image failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict")
async def predict(
    request: PredictRequest,
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, Any]:
    """
    Run segmentation on a loaded session.

    Exactly one of text, box, or (points + point_labels) must be provided.
    Returns a list of masks as base64-encoded grayscale PNGs with confidence scores.
    """
    try:
        if request.text:
            result = provider.predict_from_text(request.session_id, request.text)
        elif request.box:
            result = provider.predict_from_box(request.session_id, request.box)
        elif request.points is not None and request.point_labels is not None:
            result = provider.predict_from_points(
                request.session_id, request.points, request.point_labels
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide exactly one of: text, box, or points + point_labels",
            )
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error({"error": str(e)}, "predict failed")
        raise HTTPException(status_code=500, detail=str(e))

    return result


@router.post("/apply/background-remove")
async def background_remove(
    request: ApplyRequest,
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, str]:
    """Remove the background from the masked region. Returns a transparent PNG."""
    return _run_apply(
        provider, request.session_id, request.mask_b64, apply_background_remove
    )


@router.post("/apply/isolate")
async def isolate(
    request: ApplyRequest,
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, str]:
    """Crop and isolate the masked subject with a transparent background."""
    return _run_apply(
        provider, request.session_id, request.mask_b64, apply_isolate
    )


@router.post("/apply/blur")
async def blur_region(
    request: BlurRequest,
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, str]:
    """Apply Gaussian blur to the masked region (useful for privacy redaction)."""
    return _run_apply(
        provider,
        request.session_id,
        request.mask_b64,
        lambda img, mask: apply_blur(img, mask, request.radius),
    )


@router.post("/apply/enhance")
async def enhance_region(
    request: EnhanceRequest,
    provider: SegmentationProvider = Depends(get_provider),
) -> dict[str, str]:
    """
    Apply sharpening to the masked region only.

    Note: Full GFPGAN/RealESRGAN integration over masked regions is a
    follow-on phase. This endpoint uses PIL UnsharpMask as the initial
    implementation.
    """
    return _run_apply(
        provider, request.session_id, request.mask_b64, apply_enhance
    )
