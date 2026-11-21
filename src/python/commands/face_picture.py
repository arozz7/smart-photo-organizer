"""
Model question "a real person, or only a picture of one?" for each face (Phase C of the non-face and picture plan,
docs/plans/pictures-suggestions-plan.md; measured in docs/measurements/pictures.md).

It is the same machinery as `face_visibility` (a small batch of faces, a crop around each box, the shared vision model, the log-odds of the
first word of the answer) with another question, another pair of answer words and a wider crop, so the model can see a frame, poster or
screen around the face. The score is a ranking signal, never a verdict: higher means "only a picture of a person".
"""

import logging
from typing import Any, Callable, Dict, Optional

from PIL import Image

from commands import face_visibility
from commands.face_visibility import Ask, FaceVisibilityError, Item, MAX_BATCH

__all__ = ['CROP_MULTIPLIER', 'MAX_BATCH', 'open_crop', 'load_vlm_ask', 'handle_score_request']

logger = logging.getLogger('ai_engine.face_picture')

# Measured in Phase A: the crop that carries the frame, poster or screen around the face is 3.5 times the box's longer side.
CROP_MULTIPLIER = 3.5


def open_crop(item: Item) -> Image.Image:
    """Opens the item's image and returns the model crop, 3.5 times the box (see `face_visibility.open_crop`)."""
    return face_visibility.open_crop(item, CROP_MULTIPLIER)


def load_vlm_ask(question: Optional[str] = None) -> Ask:
    """Loads the shared vision model (once) and returns the real `ask` for the picture question.

    Raises:
        FaceVisibilityError: The model is missing or the machine has no GPU (about 0.6 s a face on a GPU, far too slow on a CPU).
    """
    import facelib.vlm as vlm
    from config import FACE_PICTURE_PROMPT

    if vlm.vlm_model is None:
        vlm.init_vlm()
    if vlm.vlm_model is None or vlm.vlm_processor is None:
        raise FaceVisibilityError('The vision model is not available')
    if getattr(vlm.vlm_model.device, 'type', '') != 'cuda':
        raise FaceVisibilityError('A GPU is required for this check')
    return face_visibility.make_vlm_ask(vlm.vlm_processor, vlm.vlm_model, question or FACE_PICTURE_PROMPT, higher_word='PICTURE', lower_word='REAL')


def handle_score_request(
    payload: Any,
    req_id: Any = None,
    ask: Optional[Ask] = None,
    load_model: Callable[[], Ask] = load_vlm_ask,
) -> Dict[str, Any]:
    """Command `score_face_picture`: payload `{items: [{faceId, imagePath, box, photoWidth}]}`, at most MAX_BATCH."""
    return face_visibility.handle_batch_request(payload, req_id, ask, load_model, open_crop, 'score_face_picture_result')
