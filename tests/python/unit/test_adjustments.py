"""
Unit tests for segmentation_ops.apply_adjustments (Phase 117).

Tests each adjustment in isolation with known pixel values, then
verifies pipeline order and scope compositing logic.
No torch / SAM / network required — pure PIL + numpy.
"""

import base64
import io
import sys
import os

import numpy as np
import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_here = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.normpath(os.path.join(_here, '..', '..', '..', 'src', 'python'))
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

from facelib.segmentation_ops import apply_adjustments  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rgb_image(color: tuple[int, int, int], size: tuple[int, int] = (100, 100)) -> Image.Image:
    return Image.new("RGB", size, color)


def _half_mask(size: tuple[int, int] = (100, 100)) -> np.ndarray:
    """float32 mask: left half = 1.0 (subject), right half = 0.0 (background)."""
    mask = np.zeros(size, dtype=np.float32)
    mask[:, : size[1] // 2] = 1.0
    return mask


def _pixel(img: Image.Image, xy: tuple[int, int]) -> tuple[int, int, int]:
    return img.getpixel(xy)[:3]


def _default_params() -> dict:
    return {}  # all defaults → identity transform


# ---------------------------------------------------------------------------
# White Balance
# ---------------------------------------------------------------------------

class TestWhiteBalance:
    def test_neutral_temperature_is_noop(self):
        img = _rgb_image((128, 128, 128))
        result = apply_adjustments(img, {"temperature": 0.0})
        r, g, b = _pixel(result, (50, 50))
        assert abs(r - 128) <= 2
        assert abs(g - 128) <= 2
        assert abs(b - 128) <= 2

    def test_warm_raises_red_lowers_blue(self):
        img = _rgb_image((128, 128, 128))
        result = apply_adjustments(img, {"temperature": 1.0})
        r, g, b = _pixel(result, (50, 50))
        assert r > 128, "Warm shift should raise red"
        assert b < 128, "Warm shift should lower blue"
        assert abs(g - 128) <= 2, "Green channel should be unchanged"

    def test_cool_raises_blue_lowers_red(self):
        img = _rgb_image((128, 128, 128))
        result = apply_adjustments(img, {"temperature": -1.0})
        r, g, b = _pixel(result, (50, 50))
        assert r < 128, "Cool shift should lower red"
        assert b > 128, "Cool shift should raise blue"

    def test_output_clips_to_255(self):
        img = _rgb_image((255, 128, 255))
        result = apply_adjustments(img, {"temperature": 1.0})
        r, g, b = _pixel(result, (50, 50))
        assert r <= 255
        assert b >= 0

    def test_output_mode_is_rgb(self):
        img = _rgb_image((100, 100, 100))
        result = apply_adjustments(img, {"temperature": 0.5})
        assert result.mode == "RGB"


# ---------------------------------------------------------------------------
# Levels
# ---------------------------------------------------------------------------

class TestLevels:
    def test_black_point_zero_is_noop(self):
        img = _rgb_image((100, 100, 100))
        result = apply_adjustments(img, {"black_point": 0, "white_point": 255})
        assert abs(_pixel(result, (50, 50))[0] - 100) <= 2

    def test_black_point_remaps_midpoint(self):
        # black_point=50: value 50 → 0, value 255 → 255
        img = _rgb_image((50, 50, 50))
        result = apply_adjustments(img, {"black_point": 50, "white_point": 255})
        r, _, _ = _pixel(result, (50, 50))
        assert r <= 5, f"Value at black_point should map to ~0, got {r}"

    def test_white_point_255_is_noop(self):
        img = _rgb_image((200, 200, 200))
        result = apply_adjustments(img, {"black_point": 0, "white_point": 255})
        assert abs(_pixel(result, (50, 50))[0] - 200) <= 2

    def test_white_point_remaps_to_255(self):
        # white_point=200: value 200 → 255
        img = _rgb_image((200, 200, 200))
        result = apply_adjustments(img, {"black_point": 0, "white_point": 200})
        r, _, _ = _pixel(result, (50, 50))
        assert r >= 250, f"Value at white_point should map to ~255, got {r}"

    def test_black_white_point_combined(self):
        # black=50, white=200 → [50,200] → [0,255]; value 125 (midpoint) → ~127
        img = _rgb_image((125, 125, 125))
        result = apply_adjustments(img, {"black_point": 50, "white_point": 200})
        r, _, _ = _pixel(result, (50, 50))
        assert abs(r - 127) <= 10, f"Midpoint should map near 127, got {r}"

    def test_output_mode_is_rgb(self):
        img = _rgb_image((100, 100, 100))
        result = apply_adjustments(img, {"black_point": 10, "white_point": 240})
        assert result.mode == "RGB"


# ---------------------------------------------------------------------------
# Brightness
# ---------------------------------------------------------------------------

class TestBrightness:
    def test_factor_1_is_noop(self):
        img = _rgb_image((120, 120, 120))
        result = apply_adjustments(img, {"brightness": 1.0})
        assert abs(_pixel(result, (50, 50))[0] - 120) <= 2

    def test_factor_2_roughly_doubles_midtones(self):
        img = _rgb_image((100, 100, 100))
        result = apply_adjustments(img, {"brightness": 2.0})
        r, _, _ = _pixel(result, (50, 50))
        assert r >= 180, f"Brightness=2 should raise value significantly, got {r}"

    def test_factor_0_produces_near_black(self):
        img = _rgb_image((200, 200, 200))
        result = apply_adjustments(img, {"brightness": 0.0})
        r, g, b = _pixel(result, (50, 50))
        assert r <= 5 and g <= 5 and b <= 5

    def test_output_mode_is_rgb(self):
        img = _rgb_image((100, 100, 100))
        assert apply_adjustments(img, {"brightness": 1.5}).mode == "RGB"


# ---------------------------------------------------------------------------
# Contrast
# ---------------------------------------------------------------------------

class TestContrast:
    def test_factor_1_is_noop(self):
        img = _rgb_image((100, 100, 100))
        result = apply_adjustments(img, {"contrast": 1.0})
        assert abs(_pixel(result, (50, 50))[0] - 100) <= 2

    def test_factor_2_increases_distance_from_midpoint(self):
        # Use a two-tone image (dark left / bright right) so the mean is ~128
        # and a dark pixel (40) should move further from 128 (darken) with contrast > 1
        img = Image.new("RGB", (100, 100))
        for x in range(50):
            for y in range(100):
                img.putpixel((x, y), (40, 40, 40))
        for x in range(50, 100):
            for y in range(100):
                img.putpixel((x, y), (215, 215, 215))
        result = apply_adjustments(img, {"contrast": 2.0})
        r, _, _ = _pixel(result, (25, 50))   # dark half
        assert r < 40, f"Contrast=2 on dark pixel should darken further, got {r}"

    def test_factor_0_produces_uniform_grey(self):
        img = _rgb_image((50, 50, 200))
        result = apply_adjustments(img, {"contrast": 0.0})
        r, g, b = _pixel(result, (50, 50))
        # All channels converge to mid-grey (~128) with contrast=0
        assert abs(r - g) <= 5
        assert abs(g - b) <= 5

    def test_output_mode_is_rgb(self):
        img = _rgb_image((100, 100, 100))
        assert apply_adjustments(img, {"contrast": 1.5}).mode == "RGB"


# ---------------------------------------------------------------------------
# Shadows
# ---------------------------------------------------------------------------

class TestShadows:
    def test_shadows_lift_dark_tones(self):
        # Dark pixel (50) should be lifted when shadows > 0
        img = _rgb_image((50, 50, 50))
        result = apply_adjustments(img, {"shadows": 1.0})
        r, _, _ = _pixel(result, (50, 50))
        assert r > 50, f"Shadow lift should raise dark tones, got {r}"

    def test_shadows_do_not_affect_bright_tones(self):
        # Bright pixel (200) above midpoint should be unchanged
        img = _rgb_image((200, 200, 200))
        result = apply_adjustments(img, {"shadows": 1.0})
        r, _, _ = _pixel(result, (50, 50))
        assert abs(r - 200) <= 3, f"Shadow lift should not change bright tones, got {r}"

    def test_shadows_zero_is_noop(self):
        img = _rgb_image((80, 80, 80))
        result = apply_adjustments(img, {"shadows": 0.0})
        assert abs(_pixel(result, (50, 50))[0] - 80) <= 2

    def test_output_mode_is_rgb(self):
        img = _rgb_image((60, 60, 60))
        assert apply_adjustments(img, {"shadows": 0.5}).mode == "RGB"


# ---------------------------------------------------------------------------
# Highlights
# ---------------------------------------------------------------------------

class TestHighlights:
    def test_highlights_compress_bright_tones(self):
        # Bright pixel (210) should be pulled down when highlights > 0
        img = _rgb_image((210, 210, 210))
        result = apply_adjustments(img, {"highlights": 1.0})
        r, _, _ = _pixel(result, (50, 50))
        assert r < 210, f"Highlight compression should lower bright tones, got {r}"

    def test_highlights_do_not_affect_dark_tones(self):
        # Dark pixel (40) below midpoint should be unchanged
        img = _rgb_image((40, 40, 40))
        result = apply_adjustments(img, {"highlights": 1.0})
        r, _, _ = _pixel(result, (50, 50))
        assert abs(r - 40) <= 3, f"Highlight compression should not change dark tones, got {r}"

    def test_highlights_zero_is_noop(self):
        img = _rgb_image((200, 200, 200))
        result = apply_adjustments(img, {"highlights": 0.0})
        assert abs(_pixel(result, (50, 50))[0] - 200) <= 2

    def test_output_mode_is_rgb(self):
        img = _rgb_image((180, 180, 180))
        assert apply_adjustments(img, {"highlights": 0.5}).mode == "RGB"


# ---------------------------------------------------------------------------
# Pipeline Order
# ---------------------------------------------------------------------------

class TestPipelineOrder:
    def test_all_defaults_is_noop(self):
        """All params at default values → output ≈ input (within rounding)."""
        img = _rgb_image((120, 80, 200))
        result = apply_adjustments(img, _default_params())
        r, g, b = _pixel(result, (50, 50))
        assert abs(r - 120) <= 2
        assert abs(g - 80) <= 2
        assert abs(b - 200) <= 2

    def test_empty_params_is_noop(self):
        img = _rgb_image((100, 150, 200))
        result = apply_adjustments(img, {})
        r, g, b = _pixel(result, (50, 50))
        assert abs(r - 100) <= 2
        assert abs(g - 150) <= 2
        assert abs(b - 200) <= 2

    def test_combined_adjustments_apply(self):
        """Smoke test: multiple adjustments together don't crash and produce output."""
        img = _rgb_image((100, 100, 100))
        result = apply_adjustments(img, {
            "temperature": 0.3,
            "black_point": 10,
            "white_point": 240,
            "brightness": 1.2,
            "contrast": 1.1,
            "shadows": 0.2,
            "highlights": -0.1,
        })
        assert result.mode == "RGB"
        assert result.size == img.size


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------

class TestScope:
    def test_global_scope_no_mask_affects_full_image(self):
        """mask=None → entire image is adjusted."""
        img = _rgb_image((50, 50, 50))
        result = apply_adjustments(img, {"brightness": 2.0}, mask=None)
        # Both halves should change
        left = _pixel(result, (25, 50))[0]
        right = _pixel(result, (75, 50))[0]
        assert left > 50
        assert right > 50

    def test_segment_scope_only_changes_masked_region(self):
        """mask provided → left half (mask=1) is adjusted; right half (mask=0) is unchanged."""
        img = _rgb_image((50, 50, 50))
        mask = _half_mask()
        result = apply_adjustments(img, {"brightness": 2.0}, mask=mask)
        left = _pixel(result, (25, 50))[0]   # inside mask → brightened
        right = _pixel(result, (75, 50))[0]  # outside mask → original
        assert left > 80, f"Masked region should be brightened, got {left}"
        assert abs(right - 50) <= 5, f"Unmasked region should be unchanged, got {right}"

    def test_inverted_scope_only_changes_unmasked_region(self):
        """Inverted mask (1 - mask) → right half is adjusted; left half unchanged."""
        img = _rgb_image((50, 50, 50))
        inverted_mask = 1.0 - _half_mask()
        result = apply_adjustments(img, {"brightness": 2.0}, mask=inverted_mask)
        left = _pixel(result, (25, 50))[0]   # outside inverted mask → original
        right = _pixel(result, (75, 50))[0]  # inside inverted mask → brightened
        assert abs(left - 50) <= 5, f"Non-inverted region should be unchanged, got {left}"
        assert right > 80, f"Inverted region should be brightened, got {right}"

    def test_zero_mask_leaves_image_unchanged(self):
        """All-zero mask → no pixels adjusted (compositing returns original)."""
        img = _rgb_image((100, 100, 100))
        mask = np.zeros((100, 100), dtype=np.float32)
        result = apply_adjustments(img, {"brightness": 2.0}, mask=mask)
        r, _, _ = _pixel(result, (50, 50))
        assert abs(r - 100) <= 5

    def test_full_mask_equals_global(self):
        """All-one mask → identical result to no mask (global scope)."""
        img = _rgb_image((80, 80, 80))
        full_mask = np.ones((100, 100), dtype=np.float32)
        with_mask = apply_adjustments(img, {"brightness": 1.5}, mask=full_mask)
        without_mask = apply_adjustments(img, {"brightness": 1.5}, mask=None)
        r_mask = _pixel(with_mask, (50, 50))[0]
        r_global = _pixel(without_mask, (50, 50))[0]
        assert abs(r_mask - r_global) <= 3
