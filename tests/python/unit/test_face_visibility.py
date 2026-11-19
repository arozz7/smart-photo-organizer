"""
Unit tests for commands/face_visibility (model question "is a clear face visible", Phase B part 2).

The model itself is replaced by a fake `ask` function, so no GPU or model download is needed.
"""

import os
import sys

import pytest
from PIL import Image

_here = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.normpath(os.path.join(_here, '..', '..', '..', 'src', 'python'))
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

from commands import face_visibility  # noqa: E402


def _write_photo(tmp_path, name='photo.jpg', size=(400, 300)):
    path = tmp_path / name
    Image.new('RGB', size, (120, 90, 60)).save(path)
    return str(path)


def _item(path, face_id=1, box=None, photo_width=400):
    return {
        'faceId': face_id,
        'imagePath': path,
        'box': box or {'x': 150, 'y': 100, 'width': 100, 'height': 100},
        'photoWidth': photo_width,
    }


class TestCropWindow:
    def test_centres_on_the_box_and_widens_it_by_the_multiplier(self):
        window = face_visibility.crop_window({'x': 150, 'y': 100, 'width': 100, 'height': 100}, 1.0, 1.8, 400, 300)

        # centre (200, 150), half side 90
        assert window == (110, 60, 290, 240)

    def test_uses_the_longer_side_of_the_box(self):
        window = face_visibility.crop_window({'x': 100, 'y': 100, 'width': 40, 'height': 100}, 1.0, 1.0, 1000, 1000)

        assert window == (70, 100, 170, 200)

    def test_scales_the_box_when_the_image_is_smaller_than_the_photo(self):
        # a preview at a quarter of the photo's width: box coordinates shrink with it
        window = face_visibility.crop_window({'x': 400, 'y': 400, 'width': 200, 'height': 200}, 0.25, 1.0, 400, 400)

        assert window == (100, 100, 150, 150)

    def test_is_clamped_to_the_image(self):
        window = face_visibility.crop_window({'x': 0, 'y': 0, 'width': 100, 'height': 100}, 1.0, 1.8, 120, 90)

        assert window == (0, 0, 120, 90)

    @pytest.mark.parametrize('box', [
        {'x': 1000, 'y': 1000, 'width': 50, 'height': 50},   # entirely outside
        {'x': 10, 'y': 10, 'width': 0, 'height': 0},          # no area
    ])
    def test_returns_none_when_nothing_is_left(self, box):
        assert face_visibility.crop_window(box, 1.0, 1.8, 400, 300) is None


class TestOpenCrop:
    def test_returns_a_square_crop_of_the_configured_size(self, tmp_path):
        crop = face_visibility.open_crop(_item(_write_photo(tmp_path)))

        assert crop.size == (face_visibility.CROP_SIZE, face_visibility.CROP_SIZE)
        assert crop.mode == 'RGB'

    def test_scales_the_box_by_the_width_of_the_image_actually_opened(self, tmp_path):
        # the file is 400 wide but the box was measured on an 800 wide photo
        item = _item(_write_photo(tmp_path), box={'x': 300, 'y': 200, 'width': 200, 'height': 200}, photo_width=800)

        crop = face_visibility.open_crop(item)

        assert crop.size == (face_visibility.CROP_SIZE, face_visibility.CROP_SIZE)

    def test_raises_for_a_missing_file(self, tmp_path):
        with pytest.raises(face_visibility.FaceVisibilityError, match='open'):
            face_visibility.open_crop(_item(str(tmp_path / 'missing.jpg')))

    def test_raises_when_the_box_misses_the_image(self, tmp_path):
        item = _item(_write_photo(tmp_path), box={'x': 5000, 'y': 5000, 'width': 50, 'height': 50})

        with pytest.raises(face_visibility.FaceVisibilityError, match='box'):
            face_visibility.open_crop(item)


class TestScoreFaces:
    def test_scores_every_face_in_order(self, tmp_path):
        path = _write_photo(tmp_path)
        items = [_item(path, face_id=7), _item(path, face_id=3)]
        answers = iter([1.5, -2.0])

        results = face_visibility.score_faces(items, face_visibility.open_crop, lambda crop: next(answers))

        assert results == [{'faceId': 7, 'score': 1.5}, {'faceId': 3, 'score': -2.0}]

    def test_a_face_that_fails_does_not_stop_the_others(self, tmp_path):
        path = _write_photo(tmp_path)
        items = [_item(path, face_id=1), _item(str(tmp_path / 'gone.jpg'), face_id=2), _item(path, face_id=3)]

        results = face_visibility.score_faces(items, face_visibility.open_crop, lambda crop: 0.5)

        assert [r['faceId'] for r in results] == [1, 2, 3]
        assert results[0]['score'] == 0.5 and results[2]['score'] == 0.5
        assert results[1]['score'] is None and 'open' in results[1]['error']

    def test_a_failing_model_call_is_reported_for_that_face_only(self, tmp_path):
        path = _write_photo(tmp_path)
        calls = []

        def ask(crop):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError('CUDA out of memory')
            return 0.0

        results = face_visibility.score_faces([_item(path, 1), _item(path, 2)], face_visibility.open_crop, ask)

        assert results[0]['score'] is None and 'CUDA out of memory' in results[0]['error']
        assert results[1] == {'faceId': 2, 'score': 0.0}

    def test_a_score_that_is_not_a_finite_number_is_an_error(self, tmp_path):
        path = _write_photo(tmp_path)

        results = face_visibility.score_faces([_item(path, 1)], face_visibility.open_crop, lambda crop: float('nan'))

        assert results[0]['score'] is None and 'finite' in results[0]['error']

    def test_an_empty_batch_gives_an_empty_result(self):
        assert face_visibility.score_faces([], face_visibility.open_crop, lambda crop: 0.0) == []

    def test_an_item_without_a_face_id_is_an_error_not_a_crash(self, tmp_path):
        results = face_visibility.score_faces([{'imagePath': _write_photo(tmp_path)}], face_visibility.open_crop, lambda crop: 0.0)

        assert results[0]['faceId'] is None and results[0]['score'] is None


class TestHandleRequest:
    def test_refuses_a_batch_that_is_too_large(self):
        payload = {'items': [{'faceId': i} for i in range(face_visibility.MAX_BATCH + 1)]}

        response = face_visibility.handle_score_request(payload, 5, ask=lambda crop: 0.0)

        assert response['success'] is False and 'too many' in response['error'].lower()
        assert response['reqId'] == 5

    def test_refuses_a_missing_or_invalid_item_list(self):
        for payload in ({}, {'items': 'nope'}, {'items': None}):
            assert face_visibility.handle_score_request(payload, 1, ask=lambda crop: 0.0)['success'] is False

    def test_returns_the_results_with_the_request_id(self, tmp_path):
        payload = {'items': [_item(_write_photo(tmp_path), 9)]}

        response = face_visibility.handle_score_request(payload, 42, ask=lambda crop: 2.5)

        assert response == {
            'type': 'score_face_visibility_result',
            'success': True,
            'results': [{'faceId': 9, 'score': 2.5}],
            'reqId': 42,
        }

    def test_reports_when_the_model_cannot_be_used(self, tmp_path):
        payload = {'items': [_item(_write_photo(tmp_path), 9)]}

        def no_model():
            raise face_visibility.FaceVisibilityError('GPU required')

        response = face_visibility.handle_score_request(payload, 3, ask=None, load_model=no_model)

        assert response['success'] is False and 'GPU required' in response['error']
