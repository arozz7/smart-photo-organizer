import pytest
from unittest.mock import MagicMock, patch
import numpy as np
from facelib import vlm

@pytest.fixture
def mock_vlm_deps(mocker):
    # Mock transformers and torch
    mock_processor = MagicMock()
    mock_model = MagicMock()
    
    mocker.patch('facelib.vlm.vlm_processor', mock_processor)
    mocker.patch('facelib.vlm.vlm_model', mock_model)
    mocker.patch('facelib.vlm.VLM_ENABLED', True)
    
    return mock_processor, mock_model

def test_generate_captions_parsing(mocker, mock_vlm_deps):
    mock_processor, mock_model = mock_vlm_deps
    
    # Mock image loading
    mocker.patch('PIL.Image.open', return_value=MagicMock())
    mocker.patch('PIL.ImageOps.exif_transpose', lambda x: x)
    
    # Mock VLM output tokens and decoding
    # We want to simulate the response: "Description: Beautiful landscape\nTags: mountain, snow, sky"
    mock_processor.apply_chat_template.return_value = "dummy_prompt"
    mock_processor.return_value = MagicMock()
    mock_processor.batch_decode.return_value = ["Description: A sunny day at the park.\nTags: park, sun, trees, grass, outdoor"]
    
    # Mock model generate
    mock_model.generate.return_value = MagicMock()
    # Mock device (needed for .to(vlm_model.device))
    mock_model.device = "cpu"
    
    # Act
    desc, tags = vlm.generate_captions("dummy.jpg")
    
    # Assert
    assert desc == "A sunny day at the park."
    assert "park" in tags
    assert "sun" in tags
    assert "trees" in tags
    assert len(tags) == 5

def test_generate_captions_fallback_parsing(mocker, mock_vlm_deps):
    mock_processor, mock_model = mock_vlm_deps
    
    mocker.patch('PIL.Image.open', return_value=MagicMock())
    mocker.patch('PIL.ImageOps.exif_transpose', lambda x: x)
    
    # Return text without "Tags:" keyword to trigger fallback extraction
    mock_processor.batch_decode.return_value = ["This is a photo of a cat sitting on a rug in the living room."]
    mock_model.device = "cpu"
    
    desc, tags = vlm.generate_captions("cat.jpg")
    
    assert "cat" in tags
    assert "rug" in tags
    assert "living" in tags
    # Stopwords like "is", "a", "of" should be filtered out
    assert "is" not in tags
    assert "a" not in tags

def test_init_vlm_skips_if_loaded(mocker):
    mocker.patch('facelib.vlm.vlm_model', MagicMock())
    with patch('facelib.vlm.logger') as mock_logger:
        vlm.init_vlm()
        # Should not log "Initializing SmolVLM..."
        assert not any("Initializing SmolVLM" in str(args) for args in mock_logger.info.call_args_list)
