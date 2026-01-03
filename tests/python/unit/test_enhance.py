import pytest
import os
import cv2
import numpy as np
from unittest.mock import MagicMock, patch
from enhance import Enhancer

@pytest.fixture
def enhancer():
    return Enhancer()

def test_download_model_with_progress(mocker, enhancer):
    # Mock requests.get
    mock_response = MagicMock()
    mock_response.headers = {'content-length': '100'}
    mock_response.iter_content.return_value = [b'chunk1', b'chunk2']
    mocker.patch('requests.get', return_value=mock_response)
    
    # Mock file operations to prevent real writing
    mocker.patch('builtins.open', mocker.mock_open())
    mocker.patch('os.path.exists', return_value=False)
    
    progress_calls = []
    def progress_cb(current, total):
        progress_calls.append((current, total))
        
    path = enhancer.download_model_with_progress('RealESRGAN_x4plus', progress_cb)
    
    assert 'RealESRGAN_x4plus.pth' in path
    assert len(progress_calls) == 2
    assert progress_calls[-1] == (12, 100) # 6 + 6 bytes

def test_enhance_orchestration(mocker, enhancer):
    # Mock heavy libs
    mock_rrdb = MagicMock()
    mock_realesrgan = MagicMock()
    mock_gfpgan = MagicMock()
    mocker.patch('enhance.get_heavy_libs', return_value=(mock_rrdb, mock_realesrgan, mock_gfpgan, MagicMock()))
    
    # Configure mock_realesrgan instance
    mock_realesrgan_instance = mock_realesrgan.return_value
    mock_realesrgan_instance.enhance.return_value = (np.zeros((400, 400, 3)), None)
    
    # Mock model existence 
    mocker.patch('os.path.exists', return_value=True)
    
    # Mock cv2 image loading/saving
    mock_img = np.zeros((100, 100, 3), dtype=np.uint8)
    mocker.patch('cv2.imread', return_value=mock_img)
    mocker.patch('cv2.imwrite')
    
    # Mock EXIF transfer
    mocker.patch('piexif.load', return_value={})
    mocker.patch('piexif.dump', return_value=b'exif')
    mocker.patch('piexif.insert')
    
    # Act
    out = enhancer.enhance('input.jpg', 'output.jpg', task='upscale', face_enhance=False)
    
    # Assert
    assert out == 'output.jpg'
    mock_realesrgan_instance.enhance.assert_called_once()
    cv2.imwrite.assert_called_once()

def test_enhance_face_restore(mocker, enhancer):
    mock_rrdb = MagicMock()
    mock_realesrgan = MagicMock()
    mock_gfpgan = MagicMock()
    mocker.patch('enhance.get_heavy_libs', return_value=(mock_rrdb, mock_realesrgan, mock_gfpgan, MagicMock()))
    
    # Configure mock_gfpgan instance
    mock_gfpgan_instance = mock_gfpgan.return_value
    mock_gfpgan_instance.enhance.return_value = (None, None, np.zeros((200, 200, 3)))
    
    mocker.patch('os.path.exists', return_value=True)
    mocker.patch('cv2.imread', return_value=np.zeros((100, 100, 3)))
    mocker.patch('cv2.imwrite')
    mocker.patch('piexif.load', side_effect=Exception("No exif"))
    
    # Act
    out = enhancer.enhance('input.jpg', 'output.jpg', task='restore_faces')
    
    # Assert
    assert out == 'output.jpg'
    mock_gfpgan_instance.enhance.assert_called_once()
