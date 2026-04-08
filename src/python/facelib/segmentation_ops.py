"""
Shared image-processing helpers for segmentation apply operations.

Imported by both:
  - api/routes/segment.py  (FastAPI routes)
  - commands/segmentation.py (Python IPC commands)
"""

import base64
import io

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


# ---------------------------------------------------------------------------
# Mask helpers
# ---------------------------------------------------------------------------

def decode_mask(mask_b64: str) -> np.ndarray:
    """Decode a base64 grayscale PNG mask to a boolean numpy array [H, W]."""
    mask_bytes = base64.b64decode(mask_b64)
    mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L")
    return np.array(mask_img) > 127


def feather_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    """
    Return a float [0, 1] alpha mask with Gaussian-feathered edges.

    When radius == 0 the input boolean mask is returned as float unchanged.
    Higher radii produce softer, more gradual subject/background transitions —
    ideal for hair, fur, and foliage.
    """
    if radius <= 0:
        return mask.astype(np.float32)
    mask_img = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    blurred = mask_img.filter(ImageFilter.GaussianBlur(radius=radius))
    return np.array(blurred, dtype=np.float32) / 255.0


def encode_image(image: Image.Image) -> str:
    """Encode a PIL Image to a base64 PNG string."""
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _alpha3(alpha: np.ndarray) -> np.ndarray:
    """Expand [H, W] float alpha to [H, W, 3] for RGB compositing."""
    return alpha[:, :, np.newaxis]


def _to_alpha(mask: np.ndarray) -> np.ndarray:
    """Ensure mask is float32 [H, W] in range [0, 1]."""
    return mask if mask.dtype == np.float32 else mask.astype(np.float32)


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def apply_background_remove(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """
    Make the background fully transparent.  Subject pixels keep their alpha.
    Returns RGBA PNG.
    """
    rgba = image.convert("RGBA")
    data = np.array(rgba, dtype=np.float32)
    alpha = _to_alpha(mask)
    data[:, :, 3] = (alpha * 255).clip(0, 255)
    return Image.fromarray(data.astype(np.uint8), "RGBA")


def apply_isolate(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Extract the masked subject, crop to its bounding box, transparent background."""
    rgba = image.convert("RGBA")
    data = np.array(rgba, dtype=np.float32)
    alpha = _to_alpha(mask)
    data[:, :, 3] = (alpha * 255).clip(0, 255)
    result = Image.fromarray(data.astype(np.uint8), "RGBA")
    bool_mask = alpha > 0.1
    rows, cols = np.where(bool_mask)
    if len(rows) == 0:
        return result
    y1, y2 = int(rows.min()), int(rows.max())
    x1, x2 = int(cols.min()), int(cols.max())
    return result.crop((x1, y1, x2 + 1, y2 + 1))


def apply_blur_background(image: Image.Image, mask: np.ndarray, radius: int = 15) -> Image.Image:
    """
    Gaussian-blur the background; keep the subject sharp.

    mask == 1 → subject (kept sharp).
    mask == 0 → background (blurred).
    """
    blurred = image.filter(ImageFilter.GaussianBlur(radius=radius))
    orig = np.array(image.convert("RGB"), dtype=np.float32)
    blurred_arr = np.array(blurred.convert("RGB"), dtype=np.float32)
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * a3 + blurred_arr * (1.0 - a3)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


def apply_enhance(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Apply unsharp-mask sharpening to the subject only (masked region)."""
    sharpened = image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    orig = np.array(image.convert("RGB"), dtype=np.float32)
    sharp_arr = np.array(sharpened.convert("RGB"), dtype=np.float32)
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * (1.0 - a3) + sharp_arr * a3).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


def apply_desaturate_background(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """
    Keep the subject in full color; convert the background to grayscale.

    Creates the classic "color-pop" portrait effect without any additional models.
    """
    gray_rgb = image.convert("L").convert("RGB")
    orig = np.array(image.convert("RGB"), dtype=np.float32)
    gray_arr = np.array(gray_rgb, dtype=np.float32)
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * a3 + gray_arr * (1.0 - a3)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


def apply_fill_background(
    image: Image.Image,
    mask: np.ndarray,
    color: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """
    Replace the background with a solid color.

    color: RGB tuple (0–255 each).  Defaults to white.
    """
    orig = np.array(image.convert("RGB"), dtype=np.float32)
    fill = np.full_like(orig, fill_value=0, dtype=np.float32)
    fill[:] = color
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * a3 + fill * (1.0 - a3)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


def apply_pixelate_background(
    image: Image.Image,
    mask: np.ndarray,
    pixel_size: int = 12,
) -> Image.Image:
    """
    Pixelate the background; keep subject sharp.

    Downsizes the full image by pixel_size then upscales with NEAREST
    interpolation to produce the mosaic effect, then composites with the
    subject from the original.
    """
    w, h = image.size
    pixel_size = max(2, pixel_size)
    small = image.resize((max(1, w // pixel_size), max(1, h // pixel_size)), Image.NEAREST)
    pixelated = small.resize((w, h), Image.NEAREST)

    orig = np.array(image.convert("RGB"), dtype=np.float32)
    pix_arr = np.array(pixelated.convert("RGB"), dtype=np.float32)
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * a3 + pix_arr * (1.0 - a3)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


def apply_spotlight(
    image: Image.Image,
    mask: np.ndarray,
    brightness: float = 0.35,
) -> Image.Image:
    """
    Darken the background while leaving the subject at full brightness.

    brightness: 0.0 = fully black background, 1.0 = no change.  Default 0.35.
    """
    brightness = float(np.clip(brightness, 0.0, 1.0))
    darkened = ImageEnhance.Brightness(image.convert("RGB")).enhance(brightness)

    orig = np.array(image.convert("RGB"), dtype=np.float32)
    dark_arr = np.array(darkened, dtype=np.float32)
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * a3 + dark_arr * (1.0 - a3)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


def apply_color_tint(
    image: Image.Image,
    mask: np.ndarray,
    color: tuple[int, int, int] = (255, 165, 0),
    opacity: float = 0.5,
) -> Image.Image:
    """
    Apply a semi-transparent color wash over the background (or subject).

    color:   RGB tuple (0–255 each).  Defaults to orange.
    opacity: 0.0 = no tint, 1.0 = solid color.  Default 0.5.
    """
    opacity = float(np.clip(opacity, 0.0, 1.0))
    orig = np.array(image.convert("RGB"), dtype=np.float32)
    tint = np.full_like(orig, fill_value=0, dtype=np.float32)
    tint[:] = color
    blended = (orig * (1.0 - opacity) + tint * opacity).clip(0, 255)
    a3 = _alpha3(_to_alpha(mask))
    result = (orig * a3 + blended * (1.0 - a3)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(result)


# ---------------------------------------------------------------------------
# Compositor
# ---------------------------------------------------------------------------

def compose_layers(layers: list[dict], width: int, height: int) -> str:
    """
    Composite an ordered list of layers into a single RGBA PNG.

    Each layer dict must contain:
      sourceImageB64 : base64 PNG/JPEG of the full source image
      maskB64        : base64 grayscale PNG mask (white = subject, black = bg)
      zIndex         : int — compositing order (ascending = bottom-to-top)
      visible        : bool — skip when False
      x, y           : int  — pixel offset of layer top-left on canvas
      scaleX, scaleY : float — scale factors (1.0 = natural)
      rotation       : float — clockwise degrees
      opacity        : float — 0.0 (transparent) to 1.0 (opaque)

    Returns a base64-encoded RGBA PNG string.
    """
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    # Sort ascending so z=0 is drawn first (background), higher z is drawn on top
    sorted_layers = sorted(layers, key=lambda lyr: lyr.get("zIndex", 0))

    for lyr in sorted_layers:
        if not lyr.get("visible", True):
            continue

        src_b64: str = lyr.get("sourceImageB64", "")
        mask_b64: str = lyr.get("maskB64", "")
        if not src_b64:
            continue

        # Decode source image
        src_bytes = base64.b64decode(src_b64)
        src_img = Image.open(io.BytesIO(src_bytes)).convert("RGBA")

        # Apply mask if provided; otherwise use the full image
        if mask_b64:
            mask_arr = decode_mask(mask_b64)  # bool [H, W]
            alpha_arr = (mask_arr.astype(np.uint8) * 255)
            # Resize alpha to match src if dimensions differ
            if alpha_arr.shape[:2] != (src_img.height, src_img.width):
                alpha_img = Image.fromarray(alpha_arr, mode="L").resize(
                    (src_img.width, src_img.height), Image.LANCZOS
                )
                alpha_arr = np.array(alpha_img)
            alpha_channel = Image.fromarray(alpha_arr, mode="L")
            r, g, b, _a = src_img.split()
            src_img = Image.merge("RGBA", (r, g, b, alpha_channel))

        # Apply per-layer opacity by scaling the alpha channel
        opacity = float(lyr.get("opacity", 1.0))
        if opacity < 1.0:
            r, g, b, a = src_img.split()
            a_arr = (np.array(a, dtype=np.float32) * opacity).clip(0, 255).astype(np.uint8)
            src_img = Image.merge("RGBA", (r, g, b, Image.fromarray(a_arr, mode="L")))

        # Apply scale
        scale_x = float(lyr.get("scaleX", 1.0))
        scale_y = float(lyr.get("scaleY", 1.0))
        if scale_x != 1.0 or scale_y != 1.0:
            new_w = max(1, int(src_img.width * scale_x))
            new_h = max(1, int(src_img.height * scale_y))
            src_img = src_img.resize((new_w, new_h), Image.LANCZOS)

        # Apply rotation (PIL rotates CCW, spec uses CW degrees)
        rotation = float(lyr.get("rotation", 0.0))
        if rotation != 0.0:
            src_img = src_img.rotate(-rotation, expand=True, resample=Image.BICUBIC)

        # Paste onto canvas at (x, y) using the layer's own alpha as mask
        x = int(lyr.get("x", 0))
        y = int(lyr.get("y", 0))
        canvas.alpha_composite(src_img, dest=(x, y))

    return encode_image(canvas)
