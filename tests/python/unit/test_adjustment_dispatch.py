"""
Unit tests for commands/segmentation.apply_adjustments_command (Phase 117).

Mocks segmentation_ops.apply_adjustments to avoid image processing overhead.
Verifies routing, validation, mask handling, and error paths.
"""

import base64
import io
import sys
import os
from unittest.mock import patch, MagicMock

import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_here = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.normpath(os.path.join(_here, '..', '..', '..', 'src', 'python'))
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_image_b64(color: tuple[int, int, int] = (100, 100, 100)) -> str:
    img = Image.new("RGB", (50, 50), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _make_mask_b64() -> str:
    mask = Image.new("L", (50, 50), 255)
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _make_adjusted_image() -> Image.Image:
    return Image.new("RGB", (50, 50), (150, 150, 150))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestApplyAdjustmentsCommand:

    def _run(self, payload: dict, req_id: str | None = "req-1"):
        from commands.segmentation import apply_adjustments_command
        return apply_adjustments_command(payload, req_id)

    def test_missing_image_b64_returns_error(self):
        res = self._run({"scope": "global"})
        assert res["success"] is False
        assert "image_b64" in res["error"].lower()

    def test_empty_image_b64_returns_error(self):
        res = self._run({"image_b64": "", "scope": "global"})
        assert res["success"] is False
        assert "image_b64" in res["error"].lower()

    def test_invalid_scope_returns_error(self):
        res = self._run({"image_b64": _make_image_b64(), "scope": "invalid"})
        assert res["success"] is False
        assert "scope" in res["error"].lower()

    def test_segment_scope_without_mask_returns_error(self):
        res = self._run({"image_b64": _make_image_b64(), "scope": "segment"})
        assert res["success"] is False
        assert "mask_b64" in res["error"].lower()

    def test_segment_scope_with_empty_mask_returns_error(self):
        res = self._run({"image_b64": _make_image_b64(), "scope": "segment", "mask_b64": ""})
        assert res["success"] is False
        assert "mask_b64" in res["error"].lower()

    def test_global_scope_calls_apply_adjustments_without_mask(self):
        adjusted = _make_adjusted_image()
        with patch("facelib.segmentation_ops.apply_adjustments", return_value=adjusted) as mock_fn:
            res = self._run({
                "image_b64": _make_image_b64(),
                "scope": "global",
                "params": {"brightness": 1.5},
            })
        assert res["success"] is True
        assert "result_b64" in res
        assert res["reqId"] == "req-1"
        # mask arg must be None for global scope
        _, kwargs = mock_fn.call_args
        assert kwargs.get("mask") is None or mock_fn.call_args[0][2] is None

    def test_segment_scope_passes_decoded_mask(self):
        adjusted = _make_adjusted_image()
        with patch("facelib.segmentation_ops.apply_adjustments", return_value=adjusted) as mock_fn:
            res = self._run({
                "image_b64": _make_image_b64(),
                "scope": "segment",
                "mask_b64": _make_mask_b64(),
                "params": {"contrast": 1.2},
            })
        assert res["success"] is True
        # mask should be provided (not None) for segment scope
        call_args = mock_fn.call_args
        mask_arg = call_args[1].get("mask") if call_args[1] else call_args[0][2]
        assert mask_arg is not None

    def test_params_forwarded_to_apply_adjustments(self):
        adjusted = _make_adjusted_image()
        params = {"brightness": 1.3, "shadows": 0.5}
        with patch("facelib.segmentation_ops.apply_adjustments", return_value=adjusted) as mock_fn:
            self._run({"image_b64": _make_image_b64(), "scope": "global", "params": params})
        call_params = mock_fn.call_args[0][1]
        assert call_params.get("brightness") == 1.3
        assert call_params.get("shadows") == 0.5

    def test_missing_params_uses_empty_dict(self):
        adjusted = _make_adjusted_image()
        with patch("facelib.segmentation_ops.apply_adjustments", return_value=adjusted) as mock_fn:
            self._run({"image_b64": _make_image_b64(), "scope": "global"})
        call_params = mock_fn.call_args[0][1]
        assert isinstance(call_params, dict)

    def test_req_id_included_in_success_response(self):
        adjusted = _make_adjusted_image()
        with patch("facelib.segmentation_ops.apply_adjustments", return_value=adjusted):
            res = self._run({"image_b64": _make_image_b64(), "scope": "global"}, req_id="abc-123")
        assert res["reqId"] == "abc-123"

    def test_req_id_included_in_error_response(self):
        res = self._run({"scope": "global"}, req_id="err-999")
        assert res["reqId"] == "err-999"

    def test_invert_mask_applied_before_passing_to_adjustments(self):
        """invert_mask=True should flip the mask (1 - alpha) before passing to apply_adjustments."""
        adjusted = _make_adjusted_image()
        import numpy as np
        with patch("facelib.segmentation_ops.apply_adjustments", return_value=adjusted) as mock_fn:
            self._run({
                "image_b64": _make_image_b64(),
                "scope": "segment",
                "mask_b64": _make_mask_b64(),  # all-white mask
                "invert_mask": True,
            })
        call_args = mock_fn.call_args
        mask_arg = call_args[1].get("mask") if call_args[1] else call_args[0][2]
        # Inverted all-white mask → all zeros
        assert mask_arg is not None
        assert mask_arg.max() < 0.1, "Inverted all-white mask should be all-zero"

    def test_exception_returns_error_dict(self):
        with patch("facelib.segmentation_ops.apply_adjustments", side_effect=RuntimeError("boom")):
            res = self._run({"image_b64": _make_image_b64(), "scope": "global"})
        assert res["success"] is False
        assert "boom" in res["error"]
