"""Tests for fit_alpha_to_image: masks must always match the image they are applied to."""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

from facelib.segmentation_ops import fit_alpha_to_image  # noqa: E402


def _image(width: int, height: int) -> Image.Image:
    return Image.new("RGB", (width, height))


def test_returns_matching_mask_unchanged():
    alpha = np.ones((20, 30), dtype=np.float32)

    result = fit_alpha_to_image(alpha, _image(30, 20))

    assert result is alpha


def test_resizes_smaller_mask_up_to_the_image_size():
    alpha = np.ones((10, 10), dtype=np.float32)

    result = fit_alpha_to_image(alpha, _image(40, 20))

    assert result.shape == (20, 40)
    assert result.dtype == np.float32
    assert np.allclose(result, 1.0, atol=0.01)


def test_resizes_larger_mask_down_to_a_cropped_image():
    # e.g. a chained op after 'isolate' cropped the image to the subject
    alpha = np.zeros((100, 100), dtype=np.float32)
    alpha[:, 50:] = 1.0

    result = fit_alpha_to_image(alpha, _image(10, 10))

    assert result.shape == (10, 10)
    assert result[:, 0].mean() < 0.1 and result[:, -1].mean() > 0.9


def test_accepts_a_boolean_mask_and_returns_float32():
    mask = np.zeros((10, 10), dtype=bool)
    mask[:5] = True

    result = fit_alpha_to_image(mask, _image(20, 20))

    assert result.dtype == np.float32
    assert result.shape == (20, 20)
    assert result[:8].mean() > 0.9 and result[12:].mean() < 0.1


def test_clips_values_outside_zero_to_one():
    alpha = np.full((5, 5), 2.0, dtype=np.float32)

    result = fit_alpha_to_image(alpha, _image(10, 10))

    assert result.max() <= 1.0
