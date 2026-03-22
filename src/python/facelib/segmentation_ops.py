"""
Shared image-processing helpers for segmentation apply operations.

Imported by both:
  - api/routes/segment.py  (FastAPI routes)
  - commands/segmentation.py (Python IPC commands)
"""

import base64
import io

import numpy as np
from PIL import Image, ImageFilter


def decode_mask(mask_b64: str) -> np.ndarray:
    """Decode a base64 grayscale PNG mask to a boolean numpy array [H, W]."""
    mask_bytes = base64.b64decode(mask_b64)
    mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L")
    return np.array(mask_img) > 127


def encode_image(image: Image.Image) -> str:
    """Encode a PIL Image to a base64 PNG string."""
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def apply_background_remove(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Set non-masked pixels to fully transparent. Returns RGBA PNG."""
    rgba = image.convert("RGBA")
    data = np.array(rgba)
    data[:, :, 3] = np.where(mask, 255, 0)
    return Image.fromarray(data, "RGBA")


def apply_isolate(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Extract masked subject, crop to its bounding box, transparent background."""
    rgba = image.convert("RGBA")
    data = np.array(rgba)
    data[:, :, 3] = np.where(mask, 255, 0)
    result = Image.fromarray(data, "RGBA")
    rows, cols = np.where(mask)
    if len(rows) == 0:
        return result
    y1, y2 = int(rows.min()), int(rows.max())
    x1, x2 = int(cols.min()), int(cols.max())
    return result.crop((x1, y1, x2 + 1, y2 + 1))


def apply_blur(image: Image.Image, mask: np.ndarray, radius: int = 15) -> Image.Image:
    """Apply Gaussian blur to the masked region; leave the rest untouched."""
    blurred = image.filter(ImageFilter.GaussianBlur(radius=radius))
    result = np.array(image.convert("RGB"))
    blurred_arr = np.array(blurred.convert("RGB"))
    result[mask] = blurred_arr[mask]
    return Image.fromarray(result)


def apply_enhance(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Apply unsharp-mask sharpening to the masked region only."""
    sharpened = image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    result = np.array(image.convert("RGB"))
    sharpened_arr = np.array(sharpened.convert("RGB"))
    result[mask] = sharpened_arr[mask]
    return Image.fromarray(result)
