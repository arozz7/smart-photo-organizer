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
    text_threshold = float(payload.get("text_threshold", 0.5))
    mask_threshold = float(payload.get("mask_threshold", 0.5))
    exclusion_boxes = payload.get("exclusion_boxes")  # list[list[int]] | None

    try:
        provider = _get_provider()
        if text:
            if exclusion_boxes:
                result = provider.predict_from_text_with_exclusions(
                    session_id, text, exclusion_boxes, text_threshold, mask_threshold
                )
            else:
                result = provider.predict_from_text(
                    session_id, text, text_threshold, mask_threshold
                )
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


def _parse_hex_color(hex_str: str) -> tuple[int, int, int]:
    """Parse a CSS hex color string (#rrggbb) to an (R, G, B) int tuple."""
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def apply_operation(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """
    Apply a mask operation to the session image.

    payload.operation:        "background-remove" | "isolate" | "blur" | "enhance"
                              | "desaturate-bg" | "fill-bg"
                              | "pixelate-bg" | "spotlight" | "color-tint"
    payload.mask_b64:         base64 grayscale PNG mask from a predict call
    payload.invert_mask:      flip subject/background before applying op, default false
    payload.feather_radius:   soft-edge feathering radius applied before any op, default 0
    payload.radius:           (blur only) Gaussian radius, default 15
    payload.color:            (fill-bg / color-tint) CSS hex color string, default "#ffffff"
    payload.pixel_size:       (pixelate-bg only) mosaic block size in px, default 12
    payload.brightness:       (spotlight only) background brightness 0.0–1.0, default 0.35
    payload.tint_opacity:     (color-tint only) tint opacity 0.0–1.0, default 0.5
    """
    session_id = payload.get("session_id", "")
    operation = payload.get("operation", "background-remove")
    mask_b64 = payload.get("mask_b64", "")
    invert_mask = bool(payload.get("invert_mask", False))
    feather_radius = int(payload.get("feather_radius", 0))
    radius = int(payload.get("radius", 15))
    hex_color = str(payload.get("color", "#ffffff"))
    pixel_size = int(payload.get("pixel_size", 12))
    brightness = float(payload.get("brightness", 0.35))
    tint_opacity = float(payload.get("tint_opacity", 0.5))

    try:
        provider = _get_provider()
        image = provider.get_session_image(session_id)

        from facelib.segmentation_ops import (
            decode_mask,
            encode_image,
            feather_mask,
            apply_background_remove,
            apply_isolate,
            apply_blur_background,
            apply_enhance,
            apply_desaturate_background,
            apply_fill_background,
            apply_pixelate_background,
            apply_spotlight,
            apply_color_tint,
        )

        # Decode boolean mask → float alpha, optionally feather edges, optionally invert
        mask = decode_mask(mask_b64)
        alpha = feather_mask(mask, feather_radius)
        if invert_mask:
            alpha = 1.0 - alpha

        if operation == "background-remove":
            result_image = apply_background_remove(image, alpha)
        elif operation == "isolate":
            result_image = apply_isolate(image, alpha)
        elif operation == "blur":
            result_image = apply_blur_background(image, alpha, radius)
        elif operation == "enhance":
            result_image = apply_enhance(image, alpha)
        elif operation == "desaturate-bg":
            result_image = apply_desaturate_background(image, alpha)
        elif operation == "fill-bg":
            result_image = apply_fill_background(image, alpha, _parse_hex_color(hex_color))
        elif operation == "pixelate-bg":
            result_image = apply_pixelate_background(image, alpha, pixel_size)
        elif operation == "spotlight":
            result_image = apply_spotlight(image, alpha, brightness)
        elif operation == "color-tint":
            result_image = apply_color_tint(image, alpha, _parse_hex_color(hex_color), tint_opacity)
        else:
            return {"success": False, "error": f"Unknown operation: {operation}", "reqId": req_id}

        return {"success": True, "result_b64": encode_image(result_image), "reqId": req_id}

    except KeyError:
        return {"success": False, "error": "Session not found", "reqId": req_id}
    except Exception as e:
        logger.exception("segment_apply error")
        return {"success": False, "error": str(e), "reqId": req_id}
