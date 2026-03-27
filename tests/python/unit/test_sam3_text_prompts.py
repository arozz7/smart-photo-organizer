"""
Unit tests for Sam3Provider text-prompt (PCS) methods.

All AI model classes (Sam3Model, Sam3Processor) are mocked so no model weights
or GPU are required.  Tests verify:
  - predict_from_text calls Sam3Model with text kwarg and returns formatted masks
  - predict_from_text_with_exclusions passes neg_boxes with labels=0
  - threshold / mask_threshold are forwarded to post_process_instance_segmentation
  - get_capabilities returns text_prompts: True
  - stub errors are handled gracefully
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

# Ensure src/python is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'python'))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_gray_png(w: int = 32, h: int = 32, value: int = 255) -> bytes:
    """Return a minimal grayscale PNG with all pixels set to value."""
    buf = io.BytesIO()
    Image.fromarray(np.full((h, w), value, dtype=np.uint8), mode="L").save(buf, format="PNG")
    return buf.getvalue()


def _make_mock_provider(initialized: bool = True):
    """
    Return a Sam3Provider whose transformers classes are entirely mocked.
    The provider is pre-seeded with one session containing a 32x32 RGB image.
    """
    import torch

    # --- processor mock ---
    mock_processor = MagicMock()
    # inputs returned by processor.__call__
    mock_inputs = MagicMock()
    mock_inputs.get.return_value = torch.tensor([[32, 32]])  # original_sizes
    mock_inputs.to.return_value = mock_inputs
    mock_processor.return_value = mock_inputs

    # post_process_instance_segmentation returns a list of result objects
    mask_tensor = torch.from_numpy(np.ones((32, 32), dtype=bool))
    score_tensor = torch.tensor(0.85)
    mock_result = SimpleNamespace(masks=[mask_tensor], scores=[score_tensor])
    mock_processor.post_process_instance_segmentation.return_value = [mock_result]

    # --- model mock ---
    mock_model = MagicMock()
    mock_model.return_value = SimpleNamespace()  # outputs (passed opaquely to post_process)

    from facelib.sam3_provider import Sam3Provider
    provider = Sam3Provider.__new__(Sam3Provider)
    provider._checkpoint = "models/sam3"
    provider._device_pref = "cpu"
    provider._device = "cpu"
    provider._max_sessions = 5
    provider._model = mock_model
    provider._processor = mock_processor
    provider._tracker = MagicMock()
    provider._tracker_processor = MagicMock()
    provider._initialized = initialized
    provider._failed = False
    provider._fail_reason = ""
    provider._sessions = {}

    # Seed one session
    img = Image.fromarray(np.zeros((32, 32, 3), dtype=np.uint8), mode="RGB")
    provider._sessions["sess-1"] = {"image": img, "created_at": 0.0}

    return provider, mock_processor, mock_model


# ---------------------------------------------------------------------------
# get_capabilities
# ---------------------------------------------------------------------------

class TestGetCapabilities:
    def test_text_prompts_true(self):
        """get_capabilities must advertise text_prompts: True."""
        from facelib.sam3_provider import Sam3Provider
        provider = Sam3Provider.__new__(Sam3Provider)
        provider._checkpoint = "models/sam3"
        provider._device_pref = "cpu"
        provider._device = "cpu"
        provider._max_sessions = 5
        provider._initialized = False
        provider._failed = False
        provider._fail_reason = ""
        provider._sessions = {}

        with patch("importlib.util.find_spec", return_value=MagicMock()):
            caps = provider.get_capabilities()

        assert caps["text_prompts"] is True

    def test_model_ready_false_when_checkpoint_missing(self):
        from facelib.sam3_provider import Sam3Provider
        provider = Sam3Provider.__new__(Sam3Provider)
        provider._checkpoint = "/nonexistent/path/model.safetensors"
        provider._device_pref = "cpu"
        provider._device = "cpu"
        provider._max_sessions = 5
        provider._initialized = False
        provider._failed = False
        provider._fail_reason = ""
        provider._sessions = {}

        with patch("importlib.util.find_spec", return_value=MagicMock()):
            caps = provider.get_capabilities()

        assert caps["model_ready"] is False
        assert caps["model_file_present"] is False


# ---------------------------------------------------------------------------
# predict_from_text
# ---------------------------------------------------------------------------

class TestPredictFromText:
    def test_calls_processor_with_text_kwarg(self):
        """Sam3Processor must be called with text= kwarg (PCS mode)."""
        provider, mock_processor, _ = _make_mock_provider()
        provider.predict_from_text("sess-1", "person")

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs.get("text") == "person"
        assert "input_boxes" not in call_kwargs, "text-only call must not pass input_boxes"

    def test_returns_masks_list(self):
        provider, _, _ = _make_mock_provider()
        result = provider.predict_from_text("sess-1", "person")

        assert "masks" in result
        assert len(result["masks"]) == 1
        mask = result["masks"][0]
        assert "mask_b64" in mask
        assert "score" in mask
        assert pytest.approx(mask["score"], abs=0.01) == 0.85

    def test_thresholds_forwarded_to_post_process(self):
        provider, mock_processor, _ = _make_mock_provider()
        provider.predict_from_text("sess-1", "dog", threshold=0.3, mask_threshold=0.4)

        _, pp_kwargs = mock_processor.post_process_instance_segmentation.call_args
        assert pp_kwargs["threshold"] == pytest.approx(0.3)
        assert pp_kwargs["mask_threshold"] == pytest.approx(0.4)

    def test_empty_masks_on_post_process_error(self):
        provider, mock_processor, _ = _make_mock_provider()
        mock_processor.post_process_instance_segmentation.side_effect = RuntimeError("boom")

        result = provider.predict_from_text("sess-1", "person")
        assert result["masks"] == []

    def test_returns_error_when_provider_failed(self):
        provider, _, _ = _make_mock_provider()
        provider._failed = True
        provider._fail_reason = "weights missing"

        result = provider.predict_from_text("sess-1", "person")
        assert result["masks"] == []
        assert "weights missing" in result.get("error", "")

    def test_raises_on_unknown_session(self):
        provider, _, _ = _make_mock_provider()
        with pytest.raises(KeyError):
            provider.predict_from_text("no-such-session", "person")


# ---------------------------------------------------------------------------
# predict_from_text_with_exclusions
# ---------------------------------------------------------------------------

class TestPredictFromTextWithExclusions:
    def test_passes_neg_boxes_with_label_zero(self):
        """neg_boxes must be forwarded with input_boxes_labels=[[0, 0, ...]]."""
        provider, mock_processor, _ = _make_mock_provider()
        neg_boxes = [[0, 0, 10, 10], [5, 5, 15, 15]]
        provider.predict_from_text_with_exclusions("sess-1", "person", neg_boxes)

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs.get("text") == "person"
        assert call_kwargs["input_boxes"] == [neg_boxes]
        assert call_kwargs["input_boxes_labels"] == [[0, 0]]

    def test_single_neg_box(self):
        provider, mock_processor, _ = _make_mock_provider()
        provider.predict_from_text_with_exclusions("sess-1", "cat", [[1, 2, 3, 4]])

        call_kwargs = mock_processor.call_args.kwargs
        assert call_kwargs["input_boxes_labels"] == [[0]]

    def test_returns_masks(self):
        provider, _, _ = _make_mock_provider()
        result = provider.predict_from_text_with_exclusions(
            "sess-1", "person", [[0, 0, 8, 8]]
        )
        assert len(result["masks"]) == 1

    def test_thresholds_forwarded(self):
        provider, mock_processor, _ = _make_mock_provider()
        provider.predict_from_text_with_exclusions(
            "sess-1", "dog", [[0, 0, 5, 5]], threshold=0.2, mask_threshold=0.6
        )
        _, pp_kwargs = mock_processor.post_process_instance_segmentation.call_args
        assert pp_kwargs["threshold"] == pytest.approx(0.2)
        assert pp_kwargs["mask_threshold"] == pytest.approx(0.6)

    def test_returns_error_when_provider_failed(self):
        provider, _, _ = _make_mock_provider()
        provider._failed = True
        provider._fail_reason = "no model"

        result = provider.predict_from_text_with_exclusions(
            "sess-1", "person", [[0, 0, 5, 5]]
        )
        assert result["masks"] == []
        assert "no model" in result.get("error", "")
