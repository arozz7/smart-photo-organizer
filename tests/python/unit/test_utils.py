import pytest
import os
import sys
from unittest.mock import MagicMock, patch
from facelib import utils

def test_inject_runtime_dev_mode(mocker):
    mocker.patch.dict(os.environ, {"IS_DEV": "true"})
    result = utils.inject_runtime()
    assert result is False

def test_inject_runtime_not_found(mocker):
    mocker.patch.dict(os.environ, {"IS_DEV": "false"})
    mocker.patch('os.path.exists', return_value=False)
    result = utils.inject_runtime()
    assert result is False

def test_get_torch_success(mocker):
    mock_torch = MagicMock()
    with patch.dict('sys.modules', {'torch': mock_torch}):
        result = utils.get_torch()
        assert result == mock_torch

def test_get_torch_failure(mocker):
    with patch.dict('sys.modules', {'torch': None}):
        # Mocking import failure is tricky with just patch.dict if it's already loaded.
        # But utils.get_torch uses a try-except around 'import torch'.
        with patch('builtins.__import__', side_effect=ImportError):
            result = utils.get_torch()
            assert result is None

def test_get_model_status_structure():
    model_urls = {"test_model": "http://example.com/model.pth"}
    weights_dir = "/tmp/weights"
    
    with patch('os.path.exists', return_value=True), \
         patch('os.path.getsize', return_value=1234):
        status = utils.get_model_status(model_urls, weights_dir)
        
        assert "AI GPU Runtime (Torch/CUDA)" in status
        assert "test_model" in status
        assert status["test_model"]["exists"] is True
        assert status["test_model"]["size"] == 1234
        assert "Buffalo_L (InsightFace)" in status

def test_configure_logging():
    # Just verify it doesn't crash and returns a logger
    logger = utils.configure_logging()
    assert logger.name == 'ai_engine'
    assert logger.hasHandlers()
