"""
Unit tests for Phase 113 segmentation operations:
  apply_pixelate_background, apply_spotlight, apply_color_tint
  and the invert_mask path in apply_operation dispatch.

No AI models are loaded — tests use synthetic PIL images and numpy arrays.
"""

import sys
import os
import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'python'))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rgb_image(w: int = 64, h: int = 64, color: tuple = (100, 150, 200)) -> Image.Image:
    data = np.full((h, w, 3), color, dtype=np.uint8)
    return Image.fromarray(data, mode="RGB")


def _half_mask(w: int = 64, h: int = 64) -> np.ndarray:
    """Boolean mask: left half = True (subject), right half = False (background)."""
    mask = np.zeros((h, w), dtype=bool)
    mask[:, : w // 2] = True
    return mask


def _float_mask(w: int = 64, h: int = 64) -> np.ndarray:
    return _half_mask(w, h).astype(np.float32)


# ---------------------------------------------------------------------------
# apply_pixelate_background
# ---------------------------------------------------------------------------

class TestPixelateBackground:
    def test_output_size_matches_input(self):
        from facelib.segmentation_ops import apply_pixelate_background
        img = _rgb_image()
        mask = _float_mask()
        result = apply_pixelate_background(img, mask, pixel_size=8)
        assert result.size == img.size

    def test_subject_pixels_unchanged(self):
        """Left half (subject) must match the original exactly."""
        from facelib.segmentation_ops import apply_pixelate_background
        color = (100, 150, 200)
        img = _rgb_image(color=color)
        mask = _float_mask()
        result = apply_pixelate_background(img, mask, pixel_size=8)
        arr = np.array(result)
        # Subject (left half) should be the original color
        np.testing.assert_array_equal(arr[:, :32], np.full((64, 32, 3), color, dtype=np.uint8))

    def test_background_pixels_are_different(self):
        """Right half (background) must differ from original after pixelation."""
        from facelib.segmentation_ops import apply_pixelate_background
        # Use a gradient image so pixelation produces visibly different values
        data = np.tile(np.arange(64, dtype=np.uint8), (64, 1))
        data = np.stack([data, data, data], axis=2)
        img = Image.fromarray(data, mode="RGB")
        mask = _float_mask()
        result = apply_pixelate_background(img, mask, pixel_size=16)
        orig_arr = np.array(img)
        res_arr = np.array(result)
        # At least some background pixels must differ from the original
        assert not np.array_equal(res_arr[:, 32:], orig_arr[:, 32:])

    def test_pixel_size_clamped_to_minimum(self):
        """pixel_size < 2 must not crash."""
        from facelib.segmentation_ops import apply_pixelate_background
        img = _rgb_image()
        mask = _float_mask()
        result = apply_pixelate_background(img, mask, pixel_size=0)
        assert result.size == img.size

    def test_output_mode_is_rgb(self):
        from facelib.segmentation_ops import apply_pixelate_background
        result = apply_pixelate_background(_rgb_image(), _float_mask())
        assert result.mode == "RGB"


# ---------------------------------------------------------------------------
# apply_spotlight
# ---------------------------------------------------------------------------

class TestSpotlight:
    def test_output_size_matches_input(self):
        from facelib.segmentation_ops import apply_spotlight
        img = _rgb_image()
        result = apply_spotlight(img, _float_mask(), brightness=0.35)
        assert result.size == img.size

    def test_subject_pixels_unchanged(self):
        """Subject (mask=1) must be identical to original."""
        from facelib.segmentation_ops import apply_spotlight
        color = (200, 100, 50)
        img = _rgb_image(color=color)
        result = apply_spotlight(img, _float_mask(), brightness=0.5)
        arr = np.array(result)
        np.testing.assert_array_equal(arr[:, :32], np.full((64, 32, 3), color, dtype=np.uint8))

    def test_background_darkened(self):
        """Background (mask=0) must be darker than original when brightness < 1."""
        from facelib.segmentation_ops import apply_spotlight
        color = (200, 200, 200)
        img = _rgb_image(color=color)
        result = apply_spotlight(img, _float_mask(), brightness=0.35)
        arr = np.array(result)
        # Right half (background) should be substantially darker
        assert arr[:, 32:, 0].mean() < 150

    def test_brightness_1_is_noop(self):
        """brightness=1.0 should leave the image unchanged."""
        from facelib.segmentation_ops import apply_spotlight
        img = _rgb_image()
        result = apply_spotlight(img, _float_mask(), brightness=1.0)
        np.testing.assert_array_almost_equal(np.array(result), np.array(img.convert("RGB")), decimal=0)

    def test_brightness_clamped(self):
        """brightness outside [0,1] must not crash."""
        from facelib.segmentation_ops import apply_spotlight
        img = _rgb_image()
        apply_spotlight(img, _float_mask(), brightness=2.5)   # clamped to 1.0
        apply_spotlight(img, _float_mask(), brightness=-0.5)  # clamped to 0.0


# ---------------------------------------------------------------------------
# apply_color_tint
# ---------------------------------------------------------------------------

class TestColorTint:
    def test_output_size_matches_input(self):
        from facelib.segmentation_ops import apply_color_tint
        img = _rgb_image()
        result = apply_color_tint(img, _float_mask())
        assert result.size == img.size

    def test_subject_pixels_unchanged(self):
        """Subject (mask=1) must be identical to original."""
        from facelib.segmentation_ops import apply_color_tint
        color = (10, 20, 30)
        img = _rgb_image(color=color)
        result = apply_color_tint(img, _float_mask(), color=(255, 0, 0), opacity=0.8)
        arr = np.array(result)
        np.testing.assert_array_equal(arr[:, :32], np.full((64, 32, 3), color, dtype=np.uint8))

    def test_opacity_zero_is_noop(self):
        """opacity=0 — no tint applied, background unchanged."""
        from facelib.segmentation_ops import apply_color_tint
        img = _rgb_image(color=(80, 80, 80))
        result = apply_color_tint(img, _float_mask(), color=(255, 0, 0), opacity=0.0)
        np.testing.assert_array_almost_equal(np.array(result), np.array(img.convert("RGB")), decimal=0)

    def test_opacity_one_replaces_background_with_tint_color(self):
        """opacity=1 — background pixels become exactly the tint color."""
        from facelib.segmentation_ops import apply_color_tint
        tint = (255, 0, 128)
        img = _rgb_image(color=(50, 50, 50))
        result = apply_color_tint(img, _float_mask(), color=tint, opacity=1.0)
        arr = np.array(result)
        np.testing.assert_array_equal(arr[:, 32:], np.full((64, 32, 3), tint, dtype=np.uint8))

    def test_output_mode_is_rgb(self):
        from facelib.segmentation_ops import apply_color_tint
        result = apply_color_tint(_rgb_image(), _float_mask())
        assert result.mode == "RGB"


# ---------------------------------------------------------------------------
# invert_mask path via feather_mask
# ---------------------------------------------------------------------------

class TestInvertMask:
    def test_invert_flips_subject_and_background(self):
        """1.0 - alpha should swap which region is treated as subject."""
        from facelib.segmentation_ops import apply_spotlight
        color = (200, 200, 200)
        img = _rgb_image(color=color)
        mask = _float_mask()
        inverted = 1.0 - mask

        normal = np.array(apply_spotlight(img, mask, brightness=0.1))
        inv_result = np.array(apply_spotlight(img, inverted, brightness=0.1))

        # With normal mask: left half (subject) is bright
        assert normal[:, :32, 0].mean() > normal[:, 32:, 0].mean()
        # With inverted mask: right half becomes the "subject" (bright)
        assert inv_result[:, 32:, 0].mean() > inv_result[:, :32, 0].mean()
