"""
Model question "is a clear face visible in the middle of this crop?" (Phase B part 2 of the non-face plan).

For each face box the vision-language model (the one the verifier already uses, SmolVLM2) is asked a YES/NO
question about a tight crop. The score is how much more likely the first word of the answer is NO than YES
(a log-odds; higher means "no face visible"). It is a ranking signal, never a verdict: the app only suggests,
the user decides.

The model call is injected (`ask`), so everything but `make_vlm_ask` runs without a GPU.
"""

import logging
import math
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from PIL import Image, ImageOps

logger = logging.getLogger('ai_engine.face_visibility')

# Crop geometry measured in Phase A (docs/measurements/non-face-and-picture-faces.md): a square around the box,
# 1.8 times its longer side, resized to the model's tile size.
CROP_MULTIPLIER = 1.8
CROP_SIZE = 384
# The Electron side sends small batches; a long call blocks the single-threaded engine.
MAX_BATCH = 16

Box = Dict[str, float]
Item = Dict[str, Any]
Ask = Callable[[Image.Image], float]


class FaceVisibilityError(Exception):
    """A face could not be scored, or the model cannot be used at all."""


def crop_window(box: Box, scale: float, multiplier: float, img_w: int, img_h: int) -> Optional[Tuple[int, int, int, int]]:
    """Returns the (left, top, right, bottom) crop around a face box, or None if nothing is left.

    Args:
        box: Face box with x, y, width, height in the coordinates of the original photo.
        scale: Opened image width divided by the original photo width (1.0 for the original itself).
        multiplier: How many times the box's longer side the square crop spans.
        img_w: Width of the opened image.
        img_h: Height of the opened image.
    """
    try:
        x, y, w, h = (float(box[key]) * scale for key in ('x', 'y', 'width', 'height'))
    except (KeyError, TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    cx, cy = x + w / 2, y + h / 2
    half = max(w, h) * multiplier / 2
    left, top = max(0, int(cx - half)), max(0, int(cy - half))
    right, bottom = min(img_w, int(cx + half)), min(img_h, int(cy + half))
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def open_crop(item: Item, multiplier: Optional[float] = None) -> Image.Image:
    """Opens the item's image (a preview or the photo itself) and returns the square model crop.

    Args:
        item: The face to crop (see `crop_window` for the fields).
        multiplier: How many times the box's longer side the crop spans; CROP_MULTIPLIER when not given.

    Raises:
        FaceVisibilityError: The file cannot be opened or the box is outside the image.
    """
    try:
        with Image.open(Path(str(item.get('imagePath')))) as opened:
            image = ImageOps.exif_transpose(opened).convert('RGB')
    except (OSError, ValueError, TypeError) as error:
        raise FaceVisibilityError(f'Could not open the image: {error}') from error

    photo_width = float(item.get('photoWidth') or image.width)
    window = crop_window(item.get('box') or {}, image.width / photo_width, CROP_MULTIPLIER if multiplier is None else multiplier, image.width, image.height)
    if window is None:
        raise FaceVisibilityError('The face box is outside the image')
    return image.crop(window).resize((CROP_SIZE, CROP_SIZE))


def score_faces(items: List[Item], open_crop_fn: Callable[[Item], Image.Image], ask: Ask) -> List[Dict[str, Any]]:
    """Scores each item; one that fails is reported with an error and does not stop the others."""
    results: List[Dict[str, Any]] = []
    for item in items:
        face_id = item.get('faceId') if isinstance(item, dict) else None
        if not isinstance(face_id, int):
            results.append({'faceId': None, 'score': None, 'error': 'Missing face id'})
            continue
        try:
            score = float(ask(open_crop_fn(item)))
            if not math.isfinite(score):
                raise FaceVisibilityError('The model gave a score that is not a finite number')
            results.append({'faceId': face_id, 'score': score})
        except Exception as error:  # noqa: BLE001 - one bad face must not stop the batch
            logger.warning('Face %s could not be scored: %s', face_id, error)
            results.append({'faceId': face_id, 'score': None, 'error': str(error)[:200]})
    return results


def make_vlm_ask(processor: Any, model: Any, question: str, higher_word: str = 'NO', lower_word: str = 'YES') -> Ask:
    """Builds the real `ask`: the log-odds of `higher_word` against `lower_word` as the first word of the model's answer.

    The defaults give the visibility score (NO against YES: higher means "no clear face visible"); the picture check
    asks for PICTURE against REAL (higher means "only a picture of a person").
    """
    import torch

    tokenizer = processor.tokenizer
    lower_id = tokenizer.encode(lower_word, add_special_tokens=False)[0]
    higher_id = tokenizer.encode(higher_word, add_special_tokens=False)[0]
    messages = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': question}]}]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)

    def ask(crop: Image.Image) -> float:
        inputs = processor(text=prompt, images=[crop], return_tensors='pt').to(model.device)
        with torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=1, do_sample=False, output_scores=True, return_dict_in_generate=True)
        log_probs = torch.log_softmax(output.scores[0][0].float(), dim=-1)
        return float(log_probs[higher_id] - log_probs[lower_id])

    return ask


def load_vlm_ask(question: Optional[str] = None) -> Ask:
    """Loads the shared vision model (once) and returns the real `ask`.

    Raises:
        FaceVisibilityError: The model is missing or the machine has no GPU (about 0.6 s a face on a GPU, far too slow on a CPU).
    """
    import facelib.vlm as vlm
    from config import FACE_VISIBILITY_PROMPT

    if vlm.vlm_model is None:
        vlm.init_vlm()
    if vlm.vlm_model is None or vlm.vlm_processor is None:
        raise FaceVisibilityError('The vision model is not available')
    if getattr(vlm.vlm_model.device, 'type', '') != 'cuda':
        raise FaceVisibilityError('A GPU is required for this check')
    return make_vlm_ask(vlm.vlm_processor, vlm.vlm_model, question or FACE_VISIBILITY_PROMPT)


def _response(req_id: Any, success: bool, response_type: str = 'score_face_visibility_result', **fields: Any) -> Dict[str, Any]:
    return {'type': response_type, 'success': success, **fields, 'reqId': req_id}


def handle_batch_request(
    payload: Any,
    req_id: Any,
    ask: Optional[Ask],
    load_model: Callable[[], Ask],
    crop_fn: Callable[[Item], Image.Image],
    response_type: str,
) -> Dict[str, Any]:
    """Shared body of the scoring commands: validates the batch, loads the model if needed, scores each face with `crop_fn`."""
    items = payload.get('items') if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return _response(req_id, False, response_type, error='items must be a list')
    if len(items) > MAX_BATCH:
        return _response(req_id, False, response_type, error=f'Too many faces in one request (the limit is {MAX_BATCH})')
    if not items:
        return _response(req_id, True, response_type, results=[])
    try:
        ask_fn = ask if ask is not None else load_model()
    except FaceVisibilityError as error:
        return _response(req_id, False, response_type, error=str(error))
    return _response(req_id, True, response_type, results=score_faces(items, crop_fn, ask_fn))


def handle_score_request(
    payload: Any,
    req_id: Any = None,
    ask: Optional[Ask] = None,
    load_model: Callable[[], Ask] = load_vlm_ask,
) -> Dict[str, Any]:
    """Command `score_face_visibility`: payload `{items: [{faceId, imagePath, box, photoWidth}]}`, at most MAX_BATCH."""
    return handle_batch_request(payload, req_id, ask, load_model, open_crop, 'score_face_visibility_result')
