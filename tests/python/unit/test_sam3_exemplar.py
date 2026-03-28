"""
Unit tests for Sam3Provider.predict_from_exemplar (Phase 114).

All AI model classes (Sam3Model, Sam3Processor) are mocked so no model
weights or GPU are required.  Tests verify:
  - predict_from_exemplar calls Sam3Model with ref_box as positive exemplar
  - neg_boxes are passed with labels=0
  - mixed positive/negative labels are forwarded correctly
  - post_process_instance_segmentation results are formatted as masks
  - get_capabilities returns exemplar_prompts: True
  - graceful handling when model fails
  - commands/segmentation.predict routes exemplar_box to predict_from_exemplar
"""

import base64
import io
import sys
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, call
import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'python'))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_gray_png(w: int = 32, h: int = 32, value: int = 255) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.full((h, w), value, dtype=np.uint8), mode="L").save(buf, format="PNG")
    return buf.getvalue()


def _make_mock_provider(initialized: bool = True):
    """
    Return a Sam3Provider whose transformers classes are entirely mocked.
    Pre-seeded with one session containing a 32×32 RGB image.
    """
    import torch

    mock_processor = MagicMock()
    mock_inputs = MagicMock()
    mock_inputs.get.return_value = torch.tensor([[32, 32]])
    mock_inputs.to.return_value = mock_inputs
    mock_processor.return_value = mock_inputs

    mask_tensor = torch.from_numpy(np.ones((32, 32), dtype=bool))
    score_tensor = torch.tensor(0.90)
    mock_result = SimpleNamespace(masks=[mask_tensor], scores=[score_tensor])
    mock_processor.post_process_instance_segmentation.return_value = [mock_result]

    mock_model = MagicMock()
    mock_model.return_value = SimpleNamespace(pred_masks=MagicMock())

    from facelib.sam3_provider import Sam3Provider

    provider = Sam3Provider.__new__(Sam3Provider)
    provider._checkpoint = "models/sam3"
    provider._device_pref = "cpu"
    provider._device = "cpu"
    provider._max_sessions = 5
    provider._initialized = initialized
    provider._failed = False
    provider._fail_reason = ""
    provider._model = mock_model
    provider._processor = mock_processor
    provider._tracker = MagicMock()
    provider._tracker_processor = MagicMock()
    provider._sessions = {}

    session_id = "test-session-exemplar"
    provider._sessions[session_id] = {
        "image": Image.fromarray(np.zeros((32, 32, 3), dtype=np.uint8), mode="RGB"),
        "created_at": 0.0,
    }
    return provider, mock_processor, mock_model, session_id


# ---------------------------------------------------------------------------
# predict_from_exemplar — ref box only
# ---------------------------------------------------------------------------

class TestPredictFromExemplarRefOnly:

    def test_calls_processor_with_positive_label(self):
        """Processor receives ref_box as sole positive exemplar (label=1)."""
        provider, mock_processor, _, session_id = _make_mock_provider()
        ref_box = [10, 10, 100, 100]

        provider.predict_from_exemplar(session_id, ref_box)

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs["input_boxes"] == [[ref_box]]
        assert call_kwargs["input_boxes_labels"] == [[1]]

    def test_returns_mask_list(self):
        """Result contains a non-empty masks list with expected fields."""
        provider, _, _, session_id = _make_mock_provider()
        result = provider.predict_from_exemplar(session_id, [5, 5, 50, 50])

        assert "masks" in result
        assert len(result["masks"]) == 1
        mask = result["masks"][0]
        assert "mask_b64" in mask
        assert "score" in mask
        assert "area" in mask
        assert mask["score"] == pytest.approx(0.90, abs=0.01)

    def test_mask_b64_is_valid_png(self):
        """mask_b64 decodes to a valid grayscale PNG."""
        provider, _, _, session_id = _make_mock_provider()
        result = provider.predict_from_exemplar(session_id, [0, 0, 32, 32])

        raw = base64.b64decode(result["masks"][0]["mask_b64"])
        img = Image.open(io.BytesIO(raw))
        assert img.mode == "L"
        assert img.size == (32, 32)

    def test_calls_model(self):
        """Sam3Model (not tracker) is called."""
        provider, _, mock_model, session_id = _make_mock_provider()
        provider.predict_from_exemplar(session_id, [0, 0, 32, 32])
        mock_model.assert_called_once()

    def test_tracker_not_called(self):
        """Sam3TrackerModel is NOT called for exemplar mode."""
        provider, _, _, session_id = _make_mock_provider()
        provider.predict_from_exemplar(session_id, [0, 0, 32, 32])
        provider._tracker.assert_not_called()


# ---------------------------------------------------------------------------
# predict_from_exemplar — with negative exclusion boxes
# ---------------------------------------------------------------------------

class TestPredictFromExemplarWithNegBoxes:

    def test_neg_boxes_get_label_zero(self):
        """Negative boxes are passed with label=0 after the positive ref box."""
        provider, mock_processor, _, session_id = _make_mock_provider()
        ref_box = [10, 10, 60, 60]
        neg1 = [70, 70, 120, 120]
        neg2 = [5, 5, 20, 20]

        provider.predict_from_exemplar(session_id, ref_box, neg_boxes=[neg1, neg2])

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs["input_boxes"] == [[ref_box, neg1, neg2]]
        assert call_kwargs["input_boxes_labels"] == [[1, 0, 0]]

    def test_single_neg_box(self):
        provider, mock_processor, _, session_id = _make_mock_provider()
        ref_box = [0, 0, 30, 30]
        neg_box = [20, 20, 32, 32]

        provider.predict_from_exemplar(session_id, ref_box, neg_boxes=[neg_box])

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs["input_boxes"] == [[ref_box, neg_box]]
        assert call_kwargs["input_boxes_labels"] == [[1, 0]]

    def test_empty_neg_boxes_treated_as_no_negs(self):
        """Passing neg_boxes=[] is identical to omitting neg_boxes."""
        provider, mock_processor, _, session_id = _make_mock_provider()
        ref_box = [0, 0, 32, 32]

        provider.predict_from_exemplar(session_id, ref_box, neg_boxes=[])

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs["input_boxes"] == [[ref_box]]
        assert call_kwargs["input_boxes_labels"] == [[1]]

    def test_none_neg_boxes_treated_as_no_negs(self):
        """neg_boxes=None is treated the same as an empty list."""
        provider, mock_processor, _, session_id = _make_mock_provider()
        ref_box = [0, 0, 32, 32]

        provider.predict_from_exemplar(session_id, ref_box, neg_boxes=None)

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs["input_boxes_labels"] == [[1]]


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class TestPredictFromExemplarErrors:

    def test_invalid_session_raises_key_error(self):
        provider, _, _, _ = _make_mock_provider()
        with pytest.raises(KeyError):
            provider.predict_from_exemplar("no-such-session", [0, 0, 32, 32])

    def test_failed_provider_returns_empty_masks(self):
        provider, _, _, session_id = _make_mock_provider()
        provider._failed = True
        provider._fail_reason = "model load failed"

        result = provider.predict_from_exemplar(session_id, [0, 0, 32, 32])

        assert result["masks"] == []
        assert "error" in result

    def test_post_process_exception_returns_empty_masks(self):
        provider, mock_processor, _, session_id = _make_mock_provider()
        mock_processor.post_process_instance_segmentation.side_effect = RuntimeError("post-process error")

        result = provider.predict_from_exemplar(session_id, [0, 0, 32, 32])

        assert result["masks"] == []


# ---------------------------------------------------------------------------
# get_capabilities
# ---------------------------------------------------------------------------

class TestExemplarCapabilities:

    def test_exemplar_prompts_flag_is_true(self):
        provider, _, _, _ = _make_mock_provider()
        with patch("importlib.util.find_spec", return_value=MagicMock()):
            caps = provider.get_capabilities()
        assert caps.get("exemplar_prompts") is True

    def test_text_prompts_flag_still_true(self):
        provider, _, _, _ = _make_mock_provider()
        with patch("importlib.util.find_spec", return_value=MagicMock()):
            caps = provider.get_capabilities()
        assert caps.get("text_prompts") is True


# ---------------------------------------------------------------------------
# commands/segmentation.predict routing
# ---------------------------------------------------------------------------

class TestSegmentationCommandRouting:

    def test_exemplar_box_routes_to_predict_from_exemplar(self):
        """When exemplar_box is present, predict() calls predict_from_exemplar."""
        from commands import segmentation as seg_cmd

        mock_provider = MagicMock()
        mock_provider.predict_from_exemplar.return_value = {"masks": []}

        with patch.object(seg_cmd, "_get_provider", return_value=mock_provider):
            seg_cmd._provider = None
            result = seg_cmd.predict(
                {
                    "session_id": "s1",
                    "exemplar_box": [10, 10, 80, 80],
                    "exemplar_neg_boxes": [[5, 5, 20, 20]],
                },
                req_id="r1",
            )

        mock_provider.predict_from_exemplar.assert_called_once_with(
            "s1", [10, 10, 80, 80], [[5, 5, 20, 20]]
        )
        assert result["success"] is True

    def test_exemplar_box_without_neg_boxes_passes_empty_list(self):
        from commands import segmentation as seg_cmd

        mock_provider = MagicMock()
        mock_provider.predict_from_exemplar.return_value = {"masks": []}

        with patch.object(seg_cmd, "_get_provider", return_value=mock_provider):
            seg_cmd.predict(
                {"session_id": "s1", "exemplar_box": [0, 0, 32, 32]},
                req_id="r2",
            )

        mock_provider.predict_from_exemplar.assert_called_once_with(
            "s1", [0, 0, 32, 32], []
        )

    def test_exemplar_takes_priority_over_text(self):
        """exemplar_box is checked before text in the routing chain."""
        from commands import segmentation as seg_cmd

        mock_provider = MagicMock()
        mock_provider.predict_from_exemplar.return_value = {"masks": []}

        with patch.object(seg_cmd, "_get_provider", return_value=mock_provider):
            seg_cmd.predict(
                {
                    "session_id": "s1",
                    "exemplar_box": [0, 0, 32, 32],
                    "text": "person",
                },
                req_id="r3",
            )

        mock_provider.predict_from_exemplar.assert_called_once()
        mock_provider.predict_from_text.assert_not_called()
