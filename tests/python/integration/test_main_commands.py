import pytest
import json
import main
import numpy as np
from unittest.mock import MagicMock, patch

@pytest.fixture
def mock_ai_modules(mocker):
    # Mock face app
    mock_app = MagicMock()
    mocker.patch('facelib.faces.app', mock_app)
    
    # Mock vector store index
    mocker.patch('facelib.vector_store.index', MagicMock())
    mocker.patch('facelib.vector_store.id_map', {})
    
    # Mock VLM
    mocker.patch('facelib.vlm.vlm_model', MagicMock())
    
    # Mock enhancer
    mocker.patch('enhance.enhancer', MagicMock())
    
    # Mock blur/sharpness to always pass thresholds
    mocker.patch('facelib.image_ops.estimate_blur', return_value=100.0)
    mocker.patch('facelib.image_ops.estimate_sharpness_tenengrad', return_value=500.0)
    
    return mock_app

def test_ping_command(mocker):
    cmd = {"type": "ping", "payload": {}}
    response = main.handle_command(cmd)
    
    assert response["type"] == "pong"
    assert "aiMode" in response
    assert "vlmEnabled" in response

def test_health_check_command(mock_ai_modules):
    cmd = {"type": "health_check", "payload": {}}
    response = main.handle_command(cmd)
    
    assert response["type"] == "health_check"
    assert response["status"] == "ok"
    assert "models" in response
    assert "insightface" in response

def test_add_to_index_delegation(mocker):
    mock_add = mocker.patch('facelib.vector_store.add_vectors', return_value=5)
    
    cmd = {
        "type": "add_to_index",
        "payload": {
            "vectors": [[0.1]*512]*5,
            "ids": [1, 2, 3, 4, 5]
        }
    }
    response = main.handle_command(cmd)
    
    assert response["success"] is True
    assert response["count"] == 5
    mock_add.assert_called_once()

def test_analyze_image_mocked(mocker, mock_ai_modules):
    # Mock image loading
    mocker.patch('main.load_image_cv2', return_value=np.zeros((100, 100, 3), dtype=np.uint8))
    
    # Mock face results
    mock_face = MagicMock()
    mock_face.bbox = np.array([10, 10, 50, 50])
    mock_face.embedding = np.random.rand(512)
    mock_face.det_score = 0.9
    mock_ai_modules.get.return_value = [mock_face]
    
    # Mock VLM result
    mocker.patch('facelib.vlm.generate_captions', return_value=("A photo", ["tag1", "tag2"]))
    
    cmd = {
        "type": "analyze_image",
        "payload": {
            "photoId": 123,
            "filePath": "dummy.jpg",
            "scanMode": "FAST",
            "enableVLM": True
        }
    }
    
    # Ensure CONFIG is present (it's initialized at module level in main.py)
    # We can override it for the test if needed:
    mocker.patch.dict('main.CONFIG', {'faceBlurThreshold': 20.0})
    
    response = main.handle_command(cmd)
    
    assert response["type"] == "analysis_result"
    assert response["photoId"] == 123
    assert len(response["faces"]) == 1
    # Check box expansion: [10, 10, 50, 50] -> w=40, h=40. expansion=0.4. pad=8.
    # [10-8, 10-8, 50+8, 50+8] = [2, 2, 58, 58]
    assert response["faces"][0]["box"]["x"] == 2
    assert response["faces"][0]["box"]["width"] == 56 # 58 - 2
    assert "tags" in response
    assert response["tags"] == ["tag1", "tag2"]
    assert response["description"] == "A photo"
