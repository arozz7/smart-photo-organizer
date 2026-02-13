
import unittest
import sys
import os
import numpy as np

# Adjust path to include src/python
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../src/python')))

# Mock config
from unittest.mock import MagicMock
sys.modules['config'] = MagicMock()
# Ensure AI_CONFIG has the threshold
sys.modules['config'].AI_CONFIG = {
    'face_detection': {
        'high_quality_face_threshold': 0.70
    }
}

from facelib import nms
import logging

# Configure logging to stdout
logging.basicConfig(stream=sys.stdout, level=logging.INFO)


class TestNMSStrict(unittest.TestCase):
    def test_high_overlap_duplicate(self):
        """
        Case 1: High Overlap (IoU > 0.75).
        Expected: MERGE.
        """
        # Box A: (0,0) to (100,100)
        # Box B: (5,5) to (105,105) -> IoU ~0.82
        emb_a = [1.0, 0.0]
        emb_b = [0.0, 1.0] 
        
        face_a = {'box': {'x': 0, 'y': 0, 'width': 100, 'height': 100}, 'faceQuality': 0.90, 'descriptor': emb_a, 'id': 'face_high_iou_a'}
        face_b = {'box': {'x': 5, 'y': 5, 'width': 100, 'height': 100}, 'faceQuality': 0.85, 'descriptor': emb_b, 'id': 'face_high_iou_b'}
        
        result = nms.resolve_conflicts([face_a, face_b], {'nmsIouThresh': 0.3})
        self.assertEqual(len(result), 1, "Should merge High IoU (>0.75) duplicates")

    def test_concentric_duplicate_center_veto(self):
        """
        Case 2: Medium Overlap (IoU < 0.75) but High Containment (IoMin > 0.65) AND Close Centers (NormDist < 0.25).
        Expected: MERGE.
        """
        # Box A: (0,0) to (150,150) -> Center (75,75)
        # Box B: (10,10) to (140,140) -> Center (75,75) -> Dist = 0!
        # IoMin: Box B is fully inside A (IoMin=1.0)
        # IoU: ~0.7 (approx)
        
        # Le'ts treat them as TTA crops
        emb_a = [1.0, 0.0]
        emb_b = [0.0, 1.0]
        
        face_a = {'box': {'x': 0, 'y': 0, 'width': 150, 'height': 150}, 'faceQuality': 0.90, 'descriptor': emb_a, 'id': 'face_center_a'}
        face_b = {'box': {'x': 10, 'y': 10, 'width': 130, 'height': 130}, 'faceQuality': 0.85, 'descriptor': emb_b, 'id': 'face_center_b'}
        
        # Center A: 75, 75. Size 150.
        # Center B: 75, 75. Size 130.
        # Dist = 0.
        
        result = nms.resolve_conflicts([face_a, face_b], {'nmsIouThresh': 0.3})
        self.assertEqual(len(result), 1, "Should merge Concentric/Close Center duplicates")

    def test_mother_baby_preservation(self):
        """
        Case 3: High Containment (IoMin > 0.8) but Distant Centers (NormDist > 0.25).
        Expected: KEEP OBTH.
        """
        # Box A (Mother): (0,0) to (200,200). Center (100,100).
        # Box B (Baby): (10, 100) to (60, 150). Center (35, 125).
        # contained? Yes.
        # Center Dist: Sqrt( (100-35)^2 + (100-125)^2 ) = Sqrt(65^2 + 25^2) = Sqrt(4225+625) = 69.6
        # Avg Size: (200+50)/2 = 125.
        # Norm Dist: 69.6 / 125 = 0.55 (> 0.25).
        
        emb_a = [1.0, 0.0]
        emb_b = [0.0, 1.0]

        face_a = {'box': {'x': 0, 'y': 0, 'width': 200, 'height': 200}, 'faceQuality': 0.90, 'descriptor': emb_a, 'id': 'face_mom'}
        face_b = {'box': {'x': 10, 'y': 100, 'width': 50, 'height': 50}, 'faceQuality': 0.85, 'descriptor': emb_b, 'id': 'face_baby'}
        
        result = nms.resolve_conflicts([face_a, face_b], {'nmsIouThresh': 0.3})
        self.assertEqual(len(result), 2, "Should KEEP Mother + Baby (Distant Centers)")

    def test_mother_baby_concentric_scale(self):
        """
        Case 4: Concentric (NormDist < 0.25) but Huge Scale Difference (Ratio > 3.0).
        Expected: KEEP OBTH.
        """
        # Box A (Mother): 400x400. Area 160000.
        # Box B (Baby): 100x100. Area 10000. Ratio 16.0.
        # Centers close.
        # NormDist = 0.1
        
        emb_a = [1.0, 0.0]
        emb_b = [0.0, 1.0]

        face_a = {'box': {'x': 0, 'y': 0, 'width': 400, 'height': 400}, 'faceQuality': 0.90, 'descriptor': emb_a, 'id': 'face_mom_big'}
        face_b = {'box': {'x': 150, 'y': 150, 'width': 100, 'height': 100}, 'faceQuality': 0.85, 'descriptor': emb_b, 'id': 'face_baby_small'}
        
        result = nms.resolve_conflicts([face_a, face_b], {'nmsIouThresh': 0.3})
        self.assertEqual(len(result), 2, "Should KEEP Concentric Mother + Baby (High Scale Difference)")

    
    def test_stacked_face_duplicate_veto(self):
        """
        Case 5: Stacked Face Protection (IoU < 0.5, IoMin > 0.6) normally keeps separate.
        BUT if Centers are very close (NormDist < 0.25), it's likely a duplicate. 
        Expected: MERGE.
        """
        # Using hugs.jfif coordinates (approximate from logs)
        # Face 7: x=346, y=122, w=180, h=179.
        # Face 8: x=381, y=106, w=163, h=163.
        # This produced IoU=0.57 in previous run, triggering High Quality Exception merge.
        # Ideally we want IoU < 0.5 to trigger Stacked Face Protection merge,
        # but since we patched BOTH, verifying merge here is sufficient.
        
        face_a = {'box': {'x': 346, 'y': 122, 'width': 180, 'height': 179}, 'faceQuality': 0.82, 'descriptor': [1.0, 0.0], 'id': 'face_hugs_7'}
        face_b = {'box': {'x': 381, 'y': 106, 'width': 163, 'height': 163}, 'faceQuality': 0.85, 'descriptor': [0.0, 1.0], 'id': 'face_hugs_8'}
        
        result = nms.resolve_conflicts([face_a, face_b], {'nmsIouThresh': 0.3})
        self.assertEqual(len(result), 1, "Should MERGE Stacked Face Duplicate")

if __name__ == '__main__':
    unittest.main()
