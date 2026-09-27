"""The 'AI GPU Runtime' card must be Ready whenever GPU PyTorch is actually usable, not only
when a downloaded ai-runtime folder exists (a source/dev checkout gets CUDA PyTorch from its venv)."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

from facelib import utils  # noqa: E402

RUNTIME_CARD = "AI GPU Runtime (Torch/CUDA)"


def _status(monkeypatch, tmp_path, **kwargs):
    monkeypatch.setenv("LIBRARY_PATH", str(tmp_path))
    return utils.get_model_status({}, str(tmp_path / "weights"), **kwargs)[RUNTIME_CARD]


def test_ready_when_the_downloaded_runtime_folder_exists(monkeypatch, tmp_path):
    (tmp_path / "ai-runtime").mkdir()

    card = _status(monkeypatch, tmp_path)

    assert card["exists"] is True
    assert "note" not in card


def test_ready_when_cuda_pytorch_is_already_available_in_the_python_environment(monkeypatch, tmp_path):
    card = _status(monkeypatch, tmp_path, torch_cuda_ready=True)

    assert card["exists"] is True
    assert "python environment" in card["note"].lower()


def test_still_offers_the_download_when_there_is_neither_a_runtime_folder_nor_cuda_pytorch(monkeypatch, tmp_path):
    card = _status(monkeypatch, tmp_path, torch_cuda_ready=False)

    assert card["exists"] is False
    assert card["isRuntime"] is True
    assert card["localPath"] == str(tmp_path / "ai-runtime")


def test_the_download_location_is_unchanged_even_when_ready_via_the_environment(monkeypatch, tmp_path):
    card = _status(monkeypatch, tmp_path, torch_cuda_ready=True, runtime_url="https://example.test/rt.zip")

    assert card["localPath"] == str(tmp_path / "ai-runtime")
    assert card["url"] == "https://example.test/rt.zip"


# --- Model files: the status must look where the loaders look (current directory first) -------------

ADAFACE_CARD = "AdaFace IR50 (Face Recognition)"
SAM3_CARD = "SAM 3 (Segmentation)"


def _model_cards(monkeypatch, tmp_path):
    monkeypatch.setenv("LIBRARY_PATH", str(tmp_path / "library"))
    return utils.get_model_status({}, str(tmp_path / "weights"))


def test_finds_models_in_the_models_folder_of_the_current_directory_like_the_loaders_do(monkeypatch, tmp_path):
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "adaface_ir50_webface4m.onnx").write_bytes(b"x")
    (tmp_path / "models" / "sam3.pt").write_bytes(b"y" * 10)
    monkeypatch.chdir(tmp_path)

    cards = _model_cards(monkeypatch, tmp_path)

    assert cards[ADAFACE_CARD]["exists"] is True
    assert cards[SAM3_CARD]["exists"] is True
    assert cards[SAM3_CARD]["size"] == 10


def test_finds_models_inside_the_downloaded_runtime(monkeypatch, tmp_path):
    runtime_models = tmp_path / "library" / "ai-runtime" / "models"
    runtime_models.mkdir(parents=True)
    (runtime_models / "adaface_ir50_webface4m.onnx").write_bytes(b"x")
    monkeypatch.setattr(utils, "AI_RUNTIME_PATH", str(tmp_path / "library" / "ai-runtime"))  # fixed at import time
    empty_cwd = tmp_path / "elsewhere"
    empty_cwd.mkdir()
    monkeypatch.chdir(empty_cwd)

    cards = _model_cards(monkeypatch, tmp_path)

    assert cards[ADAFACE_CARD]["exists"] is True
    assert cards[SAM3_CARD]["exists"] is False


def test_reports_missing_when_the_files_are_nowhere(monkeypatch, tmp_path):
    empty_cwd = tmp_path / "elsewhere"
    empty_cwd.mkdir()
    monkeypatch.chdir(empty_cwd)

    cards = _model_cards(monkeypatch, tmp_path)

    assert cards[ADAFACE_CARD]["exists"] is False
    assert cards[SAM3_CARD]["exists"] is False
