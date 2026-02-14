
import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Adjust path to include src/python
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../src/python')))

# Mock config before importing vlm
sys.modules['config'] = MagicMock()
sys.modules['config'].VLM_VERIFICATION_PROMPT = "PROMPT"
sys.modules['config'].AI_CONFIG = {}

from facelib import vlm

class TestVLMTTA(unittest.TestCase):
    def setUp(self):
        # Mock VLM initialization to avoid loading heavy models
        vlm.vlm_model = MagicMock()
        vlm.vlm_processor = MagicMock()
        vlm.VLM_ENABLED = True
        vlm.logger = MagicMock()

    @patch('facelib.vlm.analyze_face_crop')
    @patch('PIL.ImageOps.exif_transpose')
    @patch('PIL.Image.open')
    def test_tta_180_degrees(self, mock_open, mock_exif, mock_analyze):
        # Arrange
        # Mock Image.open to return a dummy image
        mock_img = MagicMock()
        mock_img.size = (100, 100)
        mock_img.mode = 'RGB'
        mock_img.crop.return_value = mock_img # Return itself for crop
        
        mock_open.return_value = mock_img
        mock_exif.return_value = mock_img # Pass through

        # Mock analyze_face_crop behavior
        # First call (upright): False
        # Second call (180): True
        mock_analyze.side_effect = [
            {'is_face': False, 'reason': 'Not a face'}, # Upright
            {'is_face': True, 'reason': 'Found face upside down'} # 180 deg
        ]

        # Act
        box = {'x1': 0, 'y1': 0, 'x2': 50, 'y2': 50}
        result = vlm.verify_is_face('dummy_path.jpg', box)

        # Debug if failed
        if result['is_face'] is None:
            print(f"DEBUG: verify_is_face returned Error: {result.get('error')}")

        # Assert
        self.assertTrue(result['is_face'], f"Failed result: {result}")
        self.assertEqual(mock_analyze.call_count, 2)
        
        # Verify rotation calls
        # We expect rotate(180, expand=True)
        # Note: crop is called, then rotate is called on the crop.
        # Since crop returns mock_img, rotate is called on mock_img.
        mock_img.rotate.assert_called_with(180, expand=True)

    @patch('facelib.vlm.analyze_face_crop')
    @patch('PIL.ImageOps.exif_transpose')
    @patch('PIL.Image.open')
    def test_tta_all_fail(self, mock_open, mock_exif, mock_analyze):
        # Arrange
        mock_img = MagicMock()
        mock_img.size = (100, 100)
        mock_img.mode = 'RGB'
        mock_img.crop.return_value = mock_img
        mock_img.rotate.return_value = mock_img # Return itself
        
        mock_open.return_value = mock_img
        mock_exif.return_value = mock_img

        # Fail all: Upright, 180, 90, 270
        mock_analyze.return_value = {'is_face': False, 'reason': 'No face'}

        # Act
        box = {'x1': 0, 'y1': 0, 'x2': 50, 'y2': 50}
        result = vlm.verify_is_face('dummy_path.jpg', box)

        # Assert
        self.assertFalse(result['is_face'])
        self.assertEqual(mock_analyze.call_count, 4) # 1 + 3 rotations

if __name__ == '__main__':
    unittest.main()
