"""
Unit tests for commands/face_picture (model question "a real person, or only a picture of one?", Phase C of the non-face and picture plan).

The model is replaced by a fake `ask` function, so no GPU or model download is needed.
"""

import os
import sys

import pytest
from PIL import Image

_here = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.normpath(os.path.join(_here, '..', '..', '..', 'src', 'python'))
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

from commands import face_picture, face_visibility  # noqa: E402


def _write_photo(tmp_path, name='photo.jpg', size=(800, 600)):
    path = tmp_path / name
    Image.new('RGB', size, (120, 90, 60)).save(path)
    return str(path)


def _item(path, face_id=1, box=None, photo_width=800):
    return {
        'faceId': face_id,
        'imagePath': path,
        'box': box or {'x': 350, 'y': 250, 'width': 100, 'height': 100},
        'photoWidth': photo_width,
    }


class TestCrop:
    def test_the_picture_crop_is_wider_than_the_visibility_crop(self):
        # the model must see the frame, poster or screen around the face: 3.5 times the box (Phase A), against 1.8
        assert face_picture.CROP_MULTIPLIER == 3.5
        assert face_picture.CROP_MULTIPLIER > face_visibility.CROP_MULTIPLIER

    def test_open_crop_uses_the_picture_multiplier(self, tmp_path):
        seen = []
        original = face_visibility.crop_window

        def spy(box, scale, multiplier, w, h):
            seen.append(multiplier)
            return original(box, scale, multiplier, w, h)

        face_visibility.crop_window = spy
        try:
            crop = face_picture.open_crop(_item(_write_photo(tmp_path)))
        finally:
            face_visibility.crop_window = original

        assert seen == [3.5]
        assert crop.size == (face_visibility.CROP_SIZE, face_visibility.CROP_SIZE)

    def test_the_visibility_crop_is_unchanged(self, tmp_path):
        seen = []
        original = face_visibility.crop_window

        def spy(box, scale, multiplier, w, h):
            seen.append(multiplier)
            return original(box, scale, multiplier, w, h)

        face_visibility.crop_window = spy
        try:
            face_visibility.open_crop(_item(_write_photo(tmp_path)))
        finally:
            face_visibility.crop_window = original

        assert seen == [face_visibility.CROP_MULTIPLIER]


class TestHandleRequest:
    def test_returns_the_scores_under_the_picture_result_type(self, tmp_path):
        payload = {'items': [_item(_write_photo(tmp_path), 9)]}

        response = face_picture.handle_score_request(payload, 42, ask=lambda crop: -1.5)

        assert response == {
            'type': 'score_face_picture_result',
            'success': True,
            'results': [{'faceId': 9, 'score': -1.5}],
            'reqId': 42,
        }

    def test_refuses_a_batch_that_is_too_large(self):
        payload = {'items': [{'faceId': i} for i in range(face_picture.MAX_BATCH + 1)]}

        response = face_picture.handle_score_request(payload, 5, ask=lambda crop: 0.0)

        assert response['success'] is False and 'too many' in response['error'].lower()
        assert response['type'] == 'score_face_picture_result'

    def test_refuses_a_missing_or_invalid_item_list(self):
        for payload in ({}, {'items': 'nope'}, {'items': None}):
            assert face_picture.handle_score_request(payload, 1, ask=lambda crop: 0.0)['success'] is False

    def test_an_empty_batch_succeeds_without_loading_the_model(self):
        def must_not_load():
            raise AssertionError('the model must not be loaded for an empty batch')

        response = face_picture.handle_score_request({'items': []}, 2, ask=None, load_model=must_not_load)

        assert response['success'] is True and response['results'] == []

    def test_reports_when_the_model_cannot_be_used(self, tmp_path):
        payload = {'items': [_item(_write_photo(tmp_path), 9)]}

        def no_model():
            raise face_visibility.FaceVisibilityError('GPU required')

        response = face_picture.handle_score_request(payload, 3, ask=None, load_model=no_model)

        assert response['success'] is False and 'GPU required' in response['error']

    def test_a_face_that_cannot_be_opened_is_reported_for_that_face_only(self, tmp_path):
        good = _item(_write_photo(tmp_path), 1)
        bad = _item(str(tmp_path / 'gone.jpg'), 2)

        response = face_picture.handle_score_request({'items': [good, bad]}, 4, ask=lambda crop: 0.5)

        assert response['success'] is True
        assert response['results'][0] == {'faceId': 1, 'score': 0.5}
        assert response['results'][1]['score'] is None and 'open' in response['results'][1]['error']


class _FakeTokenizer:
    """Maps the answer words to made-up token ids."""
    ids = {'REAL': 11, 'PICTURE': 12, 'YES': 21, 'NO': 22}

    def encode(self, word, add_special_tokens=False):
        return [self.ids[word]]


class TestAnswerWords:
    def test_the_score_is_the_log_odds_of_the_higher_word_against_the_lower_one(self):
        torch = pytest.importorskip('torch')

        class Output:
            def __init__(self, scores):
                self.scores = scores

        class FakeModel:
            device = 'cpu'

            def generate(self, **kwargs):
                logits = torch.full((1, 40), -20.0)
                logits[0, 12] = 3.0   # PICTURE
                logits[0, 11] = 1.0   # REAL
                return Output((logits,))

        class FakeProcessor:
            tokenizer = _FakeTokenizer()

            def apply_chat_template(self, messages, add_generation_prompt=True, tokenize=False):
                return 'prompt'

            def __call__(self, text, images, return_tensors):
                class Inputs(dict):
                    def to(self, device):
                        return self
                return Inputs()

        ask = face_visibility.make_vlm_ask(FakeProcessor(), FakeModel(), 'q', higher_word='PICTURE', lower_word='REAL')

        assert ask(Image.new('RGB', (4, 4))) == pytest.approx(2.0, abs=1e-4)

    def test_the_visibility_default_words_are_unchanged(self):
        # NO is "higher" (no face visible), YES "lower"
        import inspect
        params = inspect.signature(face_visibility.make_vlm_ask).parameters

        assert params['higher_word'].default == 'NO'
        assert params['lower_word'].default == 'YES'
