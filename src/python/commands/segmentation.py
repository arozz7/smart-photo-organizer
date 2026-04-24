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
    exemplar_box = payload.get("exemplar_box")        # list[int] | None
    exemplar_neg_boxes = payload.get("exemplar_neg_boxes") or []  # list[list[int]]

    try:
        provider = _get_provider()
        if exemplar_box:
            result = provider.predict_from_exemplar(
                session_id, exemplar_box, exemplar_neg_boxes
            )
        elif text:
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
    enhance_opacity = float(payload.get("enhance_opacity", 1.0))
    enhance_threshold = int(payload.get("enhance_threshold", 3))

    try:
        provider = _get_provider()

        source_b64 = payload.get("source_image_b64")
        if source_b64:
            import base64
            import io
            from PIL import Image as _PILImage
            _bytes = base64.b64decode(source_b64)
            image = _PILImage.open(io.BytesIO(_bytes)).convert("RGB")
        else:
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
            result_image = apply_enhance(image, alpha, opacity=enhance_opacity, threshold=enhance_threshold)
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


def apply_adjustments_command(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """
    Apply non-destructive photo adjustments (brightness, contrast, WB, levels,
    shadows, highlights) to an image, optionally scoped to a segmentation mask.

    payload fields:
      image_b64     : str  — base64 PNG/JPEG of the source image (required)
      scope         : str  — "global" | "segment" (default "global")
      mask_b64      : str  — base64 grayscale PNG mask; required when scope="segment"
      invert_mask   : bool — flip the mask before applying (default False)
      feather_radius: int  — Gaussian feather radius for mask edges (default 0)
      params        : dict — adjustment key/value pairs (all optional)
    """
    import base64
    import io
    from PIL import Image

    image_b64: str = payload.get("image_b64", "")
    if not image_b64:
        return {"success": False, "error": "image_b64 is required", "reqId": req_id}

    scope: str = payload.get("scope", "global")
    if scope not in ("global", "segment"):
        return {"success": False, "error": "scope must be 'global' or 'segment'", "reqId": req_id}

    mask_b64: str = payload.get("mask_b64", "")
    if scope == "segment" and not mask_b64:
        return {"success": False, "error": "mask_b64 is required when scope is 'segment'", "reqId": req_id}

    try:
        from facelib.segmentation_ops import (
            apply_adjustments, decode_mask, feather_mask, encode_image,
        )

        img_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")

        mask = None
        if scope == "segment":
            feather_radius: int = int(payload.get("feather_radius", 0))
            invert_mask: bool = bool(payload.get("invert_mask", False))
            raw_mask = decode_mask(mask_b64)
            alpha = feather_mask(raw_mask, feather_radius)
            if invert_mask:
                alpha = 1.0 - alpha
            mask = alpha

        params: dict = payload.get("params") or {}
        result_image = apply_adjustments(image, params, mask=mask)

        logger.info(
            "apply_adjustments_command complete scope=%s feather=%s",
            scope,
            payload.get("feather_radius", 0),
        )
        return {"success": True, "result_b64": encode_image(result_image), "reqId": req_id}

    except Exception as e:
        logger.exception("apply_adjustments_command error")
        return {"success": False, "error": str(e), "reqId": req_id}
