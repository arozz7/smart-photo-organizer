"""
Enhancement models (RealESRGAN, GFPGAN) live in the AI runtime's models folder, next to AdaFace and SAM 3, so they
survive every new version folder. Weights saved by earlier versions next to the code are still found.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

import enhance  # noqa: E402
from facelib import utils  # noqa: E402

MODEL = "RealESRGAN_x4plus"


@pytest.fixture
def places(tmp_path, monkeypatch):
    """A library with an AI runtime folder, and a separate 'next to the code' (legacy) weights folder."""
    library = tmp_path / "library"
    runtime = library / "ai-runtime"
    legacy = tmp_path / "next-to-code" / "weights"
    (runtime / "models").mkdir(parents=True)
    legacy.mkdir(parents=True)
    monkeypatch.setenv("LIBRARY_PATH", str(library))
    monkeypatch.setattr(utils, "AI_RUNTIME_PATH", str(runtime))
    monkeypatch.setattr(enhance, "WEIGHTS_DIR", str(legacy))
    return runtime / "models", legacy


def put(folder, name=MODEL, content=b"weights"):
    path = folder / f"{name}.pth"
    path.write_bytes(content)
    return str(path)


class TestFindingWeights:
    def test_finds_a_model_in_the_runtime_models_folder(self, places):
        runtime_models, legacy = places
        expected = put(runtime_models)

        assert utils.find_enhancement_weights(MODEL, str(legacy)) == expected

    def test_still_finds_a_model_saved_next_to_the_code_by_an_earlier_version(self, places):
        runtime_models, legacy = places
        expected = put(legacy)

        assert utils.find_enhancement_weights(MODEL, str(legacy)) == expected

    def test_prefers_the_runtime_folder_when_the_model_is_in_both(self, places):
        runtime_models, legacy = places
        put(legacy)
        expected = put(runtime_models)

        assert utils.find_enhancement_weights(MODEL, str(legacy)) == expected

    def test_returns_nothing_when_the_model_is_nowhere(self, places):
        _, legacy = places

        assert utils.find_enhancement_weights(MODEL, str(legacy)) is None


class TestSaveLocation:
    def test_new_downloads_go_to_the_runtime_models_folder_when_the_runtime_is_installed(self, places):
        runtime_models, legacy = places

        assert utils.enhancement_weights_save_path(MODEL, str(legacy)) == str(runtime_models / f"{MODEL}.pth")

    def test_new_downloads_go_next_to_the_code_when_there_is_no_runtime_folder(self, places, tmp_path, monkeypatch):
        _, legacy = places
        monkeypatch.setattr(utils, "AI_RUNTIME_PATH", str(tmp_path / "no-runtime-here"))

        assert utils.enhancement_weights_save_path(MODEL, str(legacy)) == str(legacy / f"{MODEL}.pth")

    def test_a_download_never_creates_the_runtime_folder(self, places, tmp_path, monkeypatch):
        # The runtime folder's existence is what marks the GPU runtime as installed; weights must not fake it.
        _, legacy = places
        missing_runtime = tmp_path / "no-runtime-here"
        monkeypatch.setattr(utils, "AI_RUNTIME_PATH", str(missing_runtime))

        utils.enhancement_weights_save_path(MODEL, str(legacy))

        assert not missing_runtime.exists()


class TestModelStatus:
    def status(self, legacy):
        return utils.get_model_status({MODEL: "https://example.test/m.pth"}, str(legacy))[MODEL]

    def test_a_model_in_the_runtime_folder_shows_as_ready_with_its_size(self, places):
        runtime_models, legacy = places
        path = put(runtime_models, content=b"x" * 123)

        card = self.status(legacy)

        assert card["exists"] is True
        assert card["size"] == 123
        assert card["localPath"] == path

    def test_a_model_saved_next_to_the_code_still_shows_as_ready(self, places):
        _, legacy = places
        put(legacy)

        assert self.status(legacy)["exists"] is True

    def test_a_missing_model_shows_where_a_download_would_be_saved(self, places):
        runtime_models, legacy = places

        card = self.status(legacy)

        assert card["exists"] is False
        assert card["localPath"] == str(runtime_models / f"{MODEL}.pth")


class TestEnhancer:
    def test_download_reuses_a_model_already_in_the_runtime_folder(self, places, mocker):
        runtime_models, _ = places
        existing = put(runtime_models)
        get = mocker.patch("requests.get")

        path = enhance.Enhancer().download_model_with_progress(MODEL)

        assert path == existing
        get.assert_not_called()

    def test_download_saves_into_the_runtime_models_folder(self, places, mocker):
        runtime_models, _ = places
        response = MagicMock()
        response.headers = {"content-length": "6"}
        response.iter_content.return_value = [b"abc", b"def"]
        mocker.patch("requests.get", return_value=response)

        path = enhance.Enhancer().download_model_with_progress(MODEL)

        assert path == str(runtime_models / f"{MODEL}.pth")
        assert (runtime_models / f"{MODEL}.pth").read_bytes() == b"abcdef"

    def test_the_upscaler_loads_weights_from_the_runtime_folder(self, places, mocker):
        runtime_models, _ = places
        expected = put(runtime_models)
        upsampler_class = MagicMock()
        torch = MagicMock()
        torch.cuda.is_available.return_value = False
        mocker.patch.object(enhance, "get_heavy_libs", return_value=(MagicMock(), upsampler_class, MagicMock(), torch))

        enhance.Enhancer().load_upsampler(MODEL)

        assert upsampler_class.call_args.kwargs["model_path"] == expected

    def test_face_restore_loads_gfpgan_weights_from_the_runtime_folder(self, places, mocker):
        runtime_models, _ = places
        expected = put(runtime_models, name="GFPGANv1.4")
        face_class = MagicMock()
        torch = MagicMock()
        torch.cuda.is_available.return_value = False
        mocker.patch.object(enhance, "get_heavy_libs", return_value=(MagicMock(), MagicMock(), face_class, torch))

        enhance.Enhancer().load_gfpgan()

        assert face_class.call_args.kwargs["model_path"] == expected

    def test_a_missing_model_still_raises_the_not_found_error_the_ui_relies_on(self, places):
        with pytest.raises(FileNotFoundError):
            enhance.Enhancer().load_upsampler(MODEL)
