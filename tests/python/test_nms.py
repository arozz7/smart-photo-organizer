import sys
import os
import unittest
import numpy as np

# Ensure src/python is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../src/python')))

# Mock Config
CONFIG = {
    'nmsIouThresh': 0.45,
    'deduplication_iou_threshold': 0.55,
    'faceBlurThreshold': 20.0
}

# We will implement the NMS module later. For now, we try to import it.
# If it fails, we know we haven't implemented it yet (TDD).
try:
    import facelib.nms as nms
except ImportError:
    nms = None

class TestNMS(unittest.TestCase):

    def setUp(self):
        # Common embeddings
        self.embedding_A = np.random.rand(512).tolist() # Person A
        # Person B (Different)
        self.embedding_B = (np.array(self.embedding_A) * -1).tolist() 
        # Clone of A (Same Person, slight noise)
        self.embedding_A_noisy = (np.array(self.embedding_A) + 0.01).tolist()

    def test_import_exists(self):
        """Phase 1: Ensure NMS module exists"""
        self.assertIsNotNone(nms, "facelib.nms module not created yet")

    def test_camera_in_face(self):
        """
        Scenario: Nested Trash (Camera/Hand inside Face)
        Overlaps nearly 100%. Different Embeddings.
        Should MERGE and keep the higher quality one.
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'face_main',
                'box': {'x': 100, 'y': 100, 'width': 200, 'height': 200}, # Area: 40000
                'descriptor': self.embedding_A,
                'faceQuality': 0.9,
                'rotation_fix': 0
            },
            {
                'id': 'hand_inside',
                'box': {'x': 120, 'y': 120, 'width': 100, 'height': 100}, # Area: 10000. Inside Main.
                'descriptor': self.embedding_B, # Different embedding
                'faceQuality': 0.4, # Low quality
                'rotation_fix': 0
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        
        self.assertEqual(len(result), 1, "Should merge nested overlapping box even if embeddings differ")
        self.assertEqual(result[0]['id'], 'face_main', "Should keep the higher quality face")

    def test_ghost_tta_duplicate(self):
        """
        Scenario: TTA Regression (Same Person, High Overlap, Variance Veto)
        Face A and Face B overlap > 90%.
        They are the SAME person (embedding similar), BUT Age/Gender is different due to rotation.
        Old logic blocked merge due to Age Mismatch.
        New logic should Force Merge because 'Physics Trumps AI'.
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'face_upright',
                'box': {'x': 100, 'y': 100, 'width': 200, 'height': 200},
                'descriptor': self.embedding_A,
                'estimatedAge': 25,
                'gender': 'F',
                'faceQuality': 0.8,
                'rotation_fix': 0
            },
            {
                'id': 'face_rotated',
                'box': {'x': 105, 'y': 105, 'width': 195, 'height': 195}, # > 90% overlap
                'descriptor': self.embedding_A_noisy,
                'estimatedAge': 45, # Mismatch > 15 years
                'gender': 'M',      # Mismatch
                'faceQuality': 0.7,
                'rotation_fix': 90
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        
        self.assertEqual(len(result), 1, "Should force merge on high overlap despite age/gender mismatch")
        self.assertEqual(result[0]['id'], 'face_upright', "Should prefer upright face")

    def test_group_photo_distinct(self):
        """
        Scenario: Distinct Faces (Side by Side)
        Should NOT merge.
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'person_A',
                'box': {'x': 100, 'y': 100, 'width': 100, 'height': 100},
                'descriptor': self.embedding_A,
                'faceQuality': 0.8
            },
            {
                'id': 'person_B',
                'box': {'x': 250, 'y': 100, 'width': 100, 'height': 100}, # No Overlap
                'descriptor': self.embedding_B,
                'faceQuality': 0.8
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        self.assertEqual(len(result), 2, "Should keep both distinct faces")

    def test_crowd_moderate_overlap(self):
        """
        Scenario: Crowd (Moderate Overlap ~50%, Diff People)
        Should NOT merge.
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'person_A',
                'box': {'x': 100, 'y': 100, 'width': 100, 'height': 100},
                'descriptor': self.embedding_A,
            },
            {
                'id': 'person_B',
                'box': {'x': 150, 'y': 100, 'width': 100, 'height': 100}, # 50% Overlap
                'descriptor': self.embedding_B, # Different Embedding
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        self.assertEqual(len(result), 2, "Should keep distinct people even with moderate overlap")

    def test_mother_child_separation(self):
        """
        Scenario: Mother and Child (Regression)
        Overlap ~64% (IoMin), Dist ~1.33 (Ambiguous), Qualities High.
        Should NOT merge. They are distinct people.
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'mother',
                'box': {'x': 100, 'y': 100, 'width': 300, 'height': 300}, # Area 90000
                'descriptor': self.embedding_A,
                'faceQuality': 0.9,
                'estimatedAge': 30,
                'gender': 'F',
                'rotation_fix': 0
            },
            {
                'id': 'child', # Child's head overlaps mother's shoulder/face
                # Box geometry: Mother is 300x300 at (100,100), Child is 150x150 at (280,280)
                # Intersection: (280,280) to (400,400) = 120x120 = 14400
                # Child area: 150x150 = 22500
                # IoMin = 14400/22500 = 0.64 (64% overlap)
                'box': {'x': 280, 'y': 280, 'width': 150, 'height': 150},
                'descriptor': self.embedding_B,  # Different person (dist = 2.0)
                'faceQuality': 0.85, # High quality
                'estimatedAge': 1,
                'gender': 'F',
                'rotation_fix': 0
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        self.assertEqual(len(result), 2, "Should keep both Mother and Child (Ambiguous identity, imperfect overlap)")

    def test_high_quality_exception(self):
        """
        Scenario: High Quality Exception (Phase 74 Fix)
        Two faces with:
        - High Overlap (> 60%, e.g., 70%)
        - Different Identity (dist > threshold)
        - BOTH High Quality (> 0.70)
        
        Old Behavior: Rule B would merge (delete lower quality)
        New Behavior: High Quality Exception keeps both
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'mother',
                'box': {'x': 100, 'y': 100, 'width': 200, 'height': 200},
                'descriptor': self.embedding_A,
                'faceQuality': 0.85,  # High quality
                'rotation_fix': 0
            },
            {
                'id': 'baby',
                # Mother: 200x200 at (100,100) -> ends at (300,300)
                # Baby: 150x150 at (200,200) -> ends at (350,350)
                # Intersection: (200,200) to (300,300) = 100x100 = 10000
                # Baby area: 150x150 = 22500
                # IoMin = 10000/22500 = 0.44 (44% overlap - too low, need higher)
                # Let's try: Baby 150x150 at (180,180) -> ends at (330,330)
                # Intersection: (180,180) to (300,300) = 120x120 = 14400
                # IoMin = 14400/22500 = 0.64 (64% overlap - perfect!)
                'box': {'x': 180, 'y': 180, 'width': 150, 'height': 150},  # 64% overlap (IoMin)
                'descriptor': self.embedding_B,  # Different person
                'faceQuality': 0.80,  # High quality
                'rotation_fix': 0
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        self.assertEqual(len(result), 2, "Should keep both faces when both are high quality despite overlap")
        
    def test_ghost_face_still_merged(self):
        """
        Scenario: Ghost Face (Regression Test for Phase 74)
        Two faces with:
        - High Overlap (> 60%)
        - Different Identity (dist > threshold)
        - ONE Low Quality (< 0.70)
        
        Behavior: Should still merge (ghost filtering preserved)
        """
        if not nms: self.skipTest("NMS module missing")

        detections = [
            {
                'id': 'real_face',
                'box': {'x': 100, 'y': 100, 'width': 200, 'height': 200},
                'descriptor': self.embedding_A,
                'faceQuality': 0.85,  # High quality
                'rotation_fix': 0
            },
            {
                'id': 'ghost',
                'box': {'x': 150, 'y': 150, 'width': 150, 'height': 150},  # 70% overlap
                'descriptor': self.embedding_B,  # Different embedding
                'faceQuality': 0.55,  # Low quality (ghost)
                'rotation_fix': 0
            }
        ]

        result = nms.resolve_conflicts(detections, CONFIG)
        self.assertEqual(len(result), 1, "Should merge ghost face (low quality) with real face")
        self.assertEqual(result[0]['id'], 'real_face', "Should keep the high quality face")

if __name__ == '__main__':
    unittest.main()
