"""
Unit tests for segmentation_ops.compose_layers (Phase 116).

These tests use only stdlib + Pillow — no torch, no SAM, no network required.
"""

import base64
import io
import sys
import os

import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Path setup — allow importing from src/python regardless of where pytest runs
# ---------------------------------------------------------------------------
_here = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.normpath(os.path.join(_here, '..', '..', '..', 'src', 'python'))
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

from facelib.segmentation_ops import compose_layers  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _solid_rgba_b64(color: tuple[int, int, int, int], size: tuple[int, int] = (100, 100)) -> str:
    """Return a base64 RGBA PNG of a solid colour."""
    img = Image.new("RGBA", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _white_mask_b64(size: tuple[int, int] = (100, 100)) -> str:
    """Full-white mask — entire image is the subject."""
    img = Image.new("L", size, 255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _decode_result(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestComposeLayers:

    def test_empty_layers_returns_transparent_png(self):
        """Empty layer list → blank transparent canvas, no crash."""
        result = compose_layers([], 100, 100)
        img = _decode_result(result)
        assert img.size == (100, 100)
        # All pixels should be fully transparent
        r, g, b, a = img.split()
        assert max(a.getdata()) == 0

    def test_single_opaque_layer_fills_canvas(self):
        """A single fully-opaque red layer on a 100×100 canvas."""
        red = _solid_rgba_b64((255, 0, 0, 255))
        layers = [
            {
                "sourceImageB64": red,
                "maskB64": _white_mask_b64(),
                "zIndex": 0,
                "visible": True,
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 1.0,
            }
        ]
        result = compose_layers(layers, 100, 100)
        img = _decode_result(result)
        pixel = img.getpixel((50, 50))  # centre pixel
        assert pixel[0] > 200, "Red channel should be high"
        assert pixel[3] > 200, "Alpha should be high (opaque)"

    def test_invisible_layer_is_skipped(self):
        """A layer with visible=False must not affect the composite."""
        red = _solid_rgba_b64((255, 0, 0, 255))
        layers = [
            {
                "sourceImageB64": red,
                "maskB64": _white_mask_b64(),
                "zIndex": 0,
                "visible": False,   # <-- hidden
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 1.0,
            }
        ]
        result = compose_layers(layers, 100, 100)
        img = _decode_result(result)
        _, _, _, a = img.split()
        assert max(a.getdata()) == 0, "Canvas should remain transparent"

    def test_zindex_order_top_layer_wins(self):
        """
        Layer z=1 (blue) is drawn on top of z=0 (red).
        The centre pixel must be blue, not red.
        """
        red_b64 = _solid_rgba_b64((255, 0, 0, 255))
        blue_b64 = _solid_rgba_b64((0, 0, 255, 255))
        layers = [
            {
                "sourceImageB64": blue_b64,
                "maskB64": _white_mask_b64(),
                "zIndex": 1,
                "visible": True,
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 1.0,
            },
            {
                "sourceImageB64": red_b64,
                "maskB64": _white_mask_b64(),
                "zIndex": 0,
                "visible": True,
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 1.0,
            },
        ]
        result = compose_layers(layers, 100, 100)
        img = _decode_result(result)
        pixel = img.getpixel((50, 50))
        assert pixel[2] > 200, "Blue channel should win (top layer)"
        assert pixel[0] < 50,  "Red channel should be suppressed"

    def test_half_opacity_reduces_alpha(self):
        """opacity=0.5 on a fully-opaque layer should produce ~50% alpha."""
        red = _solid_rgba_b64((255, 0, 0, 255))
        layers = [
            {
                "sourceImageB64": red,
                "maskB64": _white_mask_b64(),
                "zIndex": 0,
                "visible": True,
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 0.5,
            }
        ]
        result = compose_layers(layers, 100, 100)
        img = _decode_result(result)
        _, _, _, a = img.split()
        centre_alpha = img.getpixel((50, 50))[3]
        # Should be roughly 127 (= 255 * 0.5), allow ±15 for rounding
        assert abs(centre_alpha - 127) <= 15, f"Expected ~127 alpha, got {centre_alpha}"

    def test_layer_with_empty_mask_b64_uses_full_image(self):
        """maskB64='' should composite the whole image without masking."""
        green = _solid_rgba_b64((0, 255, 0, 255))
        layers = [
            {
                "sourceImageB64": green,
                "maskB64": "",   # no mask → full-image layer
                "zIndex": 0,
                "visible": True,
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 1.0,
            }
        ]
        result = compose_layers(layers, 100, 100)
        img = _decode_result(result)
        pixel = img.getpixel((50, 50))
        assert pixel[1] > 200, "Green channel should be high"

    def test_layer_with_no_source_image_is_skipped(self):
        """A layer missing sourceImageB64 should be safely ignored."""
        layers = [
            {
                "sourceImageB64": "",
                "maskB64": "",
                "zIndex": 0,
                "visible": True,
                "x": 0, "y": 0,
                "scaleX": 1.0, "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": 1.0,
            }
        ]
        result = compose_layers(layers, 100, 100)
        img = _decode_result(result)
        _, _, _, a = img.split()
        assert max(a.getdata()) == 0, "Canvas should remain transparent"
