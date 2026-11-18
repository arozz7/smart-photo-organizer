"""
The AI mode shown in the app (GPU / CPU / SAFE_MODE) must reflect what face detection will really use, from the
first moment, not a hard-coded 'CPU' that only becomes true or false when the first photo is processed.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

from facelib import faces  # noqa: E402


def torch_with_cuda(available: bool):
    torch = MagicMock()
    torch.cuda.is_available.return_value = available
    return torch


@pytest.fixture(autouse=True)
def not_yet_initialised(monkeypatch):
    monkeypatch.setattr(faces, "AI_MODE", faces.UNINITIALISED_MODE)


def test_the_module_starts_without_a_mode_instead_of_claiming_cpu():
    assert faces.UNINITIALISED_MODE != "CPU"


def test_predicts_gpu_before_detection_has_started_when_cuda_pytorch_is_usable(monkeypatch):
    monkeypatch.setattr(faces, "get_torch", lambda: torch_with_cuda(True))

    assert faces.get_ai_mode() == "GPU"


def test_predicts_cpu_when_cuda_is_not_available(monkeypatch):
    monkeypatch.setattr(faces, "get_torch", lambda: torch_with_cuda(False))

    assert faces.get_ai_mode() == "CPU"


def test_predicts_cpu_when_pytorch_is_not_installed_at_all(monkeypatch):
    monkeypatch.setattr(faces, "get_torch", lambda: None)

    assert faces.get_ai_mode() == "CPU"


def test_predicts_cpu_when_checking_cuda_raises(monkeypatch):
    torch = MagicMock()
    torch.cuda.is_available.side_effect = RuntimeError("driver problem")
    monkeypatch.setattr(faces, "get_torch", lambda: torch)

    assert faces.get_ai_mode() == "CPU"


@pytest.mark.parametrize("mode", ["GPU", "CPU", "SAFE_MODE"])
def test_reports_the_real_mode_once_detection_has_initialised(monkeypatch, mode):
    monkeypatch.setattr(faces, "AI_MODE", mode)
    monkeypatch.setattr(faces, "get_torch", lambda: torch_with_cuda(mode != "GPU"))  # must be ignored

    assert faces.get_ai_mode() == mode
