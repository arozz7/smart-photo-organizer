"""
Compositor IPC command handler.

Exposes layer-based image compositing to the Electron main process via the
stdin/stdout IPC protocol.

  compose  →  ai:compose:layers
"""

import logging
from typing import Any

logger = logging.getLogger("ai_engine.composite")


def compose(payload: dict[str, Any], req_id: str | None = None) -> dict[str, Any]:
    """
    Composite a stack of layers into a single RGBA PNG.

    payload.layers : list[LayerSpec] — ordered layer definitions (see segmentation_ops.compose_layers)
    payload.width  : int — output canvas width in pixels
    payload.height : int — output canvas height in pixels

    Returns { success, result_b64 } or { success: false, error }.
    """
    layers: list[dict] = payload.get("layers", [])
    width: int = int(payload.get("width", 1920))
    height: int = int(payload.get("height", 1080))

    if not layers:
        return {"success": False, "error": "layers must be a non-empty list", "reqId": req_id}

    if width <= 0 or height <= 0:
        return {"success": False, "error": "width and height must be positive integers", "reqId": req_id}

    try:
        from facelib.segmentation_ops import compose_layers
        result_b64 = compose_layers(layers, width, height)
        logger.info("compose layers complete layer_count=%d width=%d height=%d", len(layers), width, height)
        return {"success": True, "result_b64": result_b64, "reqId": req_id}
    except Exception as e:
        logger.exception("composite.compose error")
        return {"success": False, "error": str(e), "reqId": req_id}
