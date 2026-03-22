"""
Segmentation IPC command handlers.

Exposes SAM 3 capabilities to the Electron main process via the stdin/stdout
IPC protocol. Each function maps 1-to-1 with an Electron IPC channel:

  segment_capabilities  →  ai:segment:capabilities
  segment_set_image     →  ai:segment:setImage
  segment_predict       →  ai:segment:predict
  segment_apply         →  ai:segment:apply
"""

import logging
from typing import Any

logger = logging.getLogger("ai_engine.segmentation")

# Module-level singleton — shared across all IPC calls in this process.
_provider = None


def _get_provider():
    """Return the singleton Sam3Provider, creating it on first call."""
    global _provider
    if _provider is None:
        from facelib.sam3_provider import Sam3Provider
        from config import AI_CONFIG

        cfg = AI_CONFIG.get("segmentation", {})
        _provider = Sam3Provider(
            model_checkpoint=cfg.get("model_checkpoint", "models/sam3"),
            device=cfg.get("device", "auto"),
            max_cached_sessions=cfg.get("max_cached_sessions", 5),
        )
    return _provider


def get_capabilities(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """Return model readiness and supported feature flags."""
    try:
        caps = _get_provider().get_capabilities()
        return {"success": True, **caps, "reqId": req_id}
    except Exception as e:
        logger.exception("segment_capabilities error")
        return {"success": False, "error": str(e), "reqId": req_id}


def set_image(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """Load an image into the provider session cache. Returns session_id."""
    image_path = payload.get("imagePath", "")
    try:
        session_id = _get_provider().set_image(image_path)
        return {"success": True, "session_id": session_id, "reqId": req_id}
    except FileNotFoundError:
        return {"success": False, "error": "Image not found", "reqId": req_id}
    except Exception as e:
        logger.exception("segment_set_image error")
        return {"success": False, "error": str(e), "reqId": req_id}


def predict(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """
    Run segmentation. Exactly one of text, box, or points+point_labels must be set.
    Returns { masks: [{mask_b64, score, area}] }.
    """
    session_id = payload.get("session_id", "")
    text = payload.get("text")
    box = payload.get("box")
    points = payload.get("points")
    point_labels = payload.get("point_labels")

    try:
        provider = _get_provider()
        if text:
            result = provider.predict_from_text(session_id, text)
        elif box and points is not None and point_labels is not None:
            result = provider.predict_from_box_and_points(session_id, box, points, point_labels)
        elif box:
            result = provider.predict_from_box(session_id, box)
        elif points is not None and point_labels is not None:
            result = provider.predict_from_points(session_id, points, point_labels)
        else:
            return {
                "success": False,
                "error": "Provide text, box, or points + point_labels",
                "reqId": req_id,
            }
        return {"success": True, **result, "reqId": req_id}
    except KeyError:
        return {"success": False, "error": "Session not found", "reqId": req_id}
    except Exception as e:
        logger.exception("segment_predict error")
        return {"success": False, "error": str(e), "reqId": req_id}


def apply_operation(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """
    Apply a mask operation to the session image.

    payload.operation: "background-remove" | "isolate" | "blur" | "enhance"
    payload.mask_b64:  base64 grayscale PNG mask from a predict call
    payload.radius:    (blur only) Gaussian radius, default 15
    """
    session_id = payload.get("session_id", "")
    operation = payload.get("operation", "background-remove")
    mask_b64 = payload.get("mask_b64", "")
    radius = int(payload.get("radius", 15))

    try:
        provider = _get_provider()
        image = provider.get_session_image(session_id)

        from facelib.segmentation_ops import (
            decode_mask,
            encode_image,
            apply_background_remove,
            apply_isolate,
            apply_blur,
            apply_enhance,
        )

        mask = decode_mask(mask_b64)

        if operation == "background-remove":
            result_image = apply_background_remove(image, mask)
        elif operation == "isolate":
            result_image = apply_isolate(image, mask)
        elif operation == "blur":
            result_image = apply_blur(image, mask, radius)
        elif operation == "enhance":
            result_image = apply_enhance(image, mask)
        else:
            return {"success": False, "error": f"Unknown operation: {operation}", "reqId": req_id}

        return {"success": True, "result_b64": encode_image(result_image), "reqId": req_id}

    except KeyError:
        return {"success": False, "error": "Session not found", "reqId": req_id}
    except Exception as e:
        logger.exception("segment_apply error")
        return {"success": False, "error": str(e), "reqId": req_id}
