"""
Unit tests for cluster_faces_dbscan pose-weighted anchor logic and the
cluster_faces command-layer integration of anchor_only_frontal.

Phase 104 — Lever 2: Pose-weighted DBSCAN anchors
When anchor_only_frontal=True, only faces with |pose_yaw| < 55° can anchor
(start) clusters. High-yaw faces can join a cluster but cannot form one.
"""
import pytest
import numpy as np
from facelib import faces
from commands.clustering import cluster_faces


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_desc(base: list, noise: float = 0.0) -> list:
    """Return a 2D descriptor close to `base` with optional jitter."""
    rng = np.random.default_rng(seed=42)
    arr = np.array(base, dtype=float)
    if noise:
        arr = arr + rng.uniform(-noise, noise, size=arr.shape)
    return arr.tolist()


# Two clearly-separated cluster centres in 2D
CENTRE_A = [1.0, 0.0]
CENTRE_B = [0.0, 1.0]


# ---------------------------------------------------------------------------
# anchor_only_frontal=False (default) — regression guard
# ---------------------------------------------------------------------------

class TestAnchorOnlyFrontalDisabled:
    def test_default_behaviour_unchanged(self):
        """anchor_only_frontal=False must produce same result as vanilla call."""
        descriptors = [
            make_desc(CENTRE_A, 0.01), make_desc(CENTRE_A, 0.01),
            make_desc(CENTRE_B, 0.01), make_desc(CENTRE_B, 0.01),
        ]
        ids = [1, 2, 3, 4]
        pose_yaws = [0.0, 60.0, 0.0, 65.0]  # mix of frontal and high-yaw

        result_default = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2
        )
        result_flag_off = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2,
            anchor_only_frontal=False, pose_yaws=pose_yaws
        )

        assert sorted(sorted(c) for c in result_default) == \
               sorted(sorted(c) for c in result_flag_off)


# ---------------------------------------------------------------------------
# anchor_only_frontal=True
# ---------------------------------------------------------------------------

class TestAnchorOnlyFrontalEnabled:

    def test_all_frontal_identical_to_vanilla(self):
        """All frontal faces → same clusters as standard DBSCAN."""
        descriptors = [
            make_desc(CENTRE_A, 0.01), make_desc(CENTRE_A, 0.01),
            make_desc(CENTRE_B, 0.01), make_desc(CENTRE_B, 0.01),
        ]
        ids = [10, 11, 20, 21]
        pose_yaws = [0.0, 10.0, 5.0, -5.0]  # all frontal

        result_vanilla = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2
        )
        result_anchored = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2,
            anchor_only_frontal=True, pose_yaws=pose_yaws
        )

        assert sorted(sorted(c) for c in result_vanilla) == \
               sorted(sorted(c) for c in result_anchored)

    def test_all_high_yaw_produces_no_clusters(self):
        """Clusters formed entirely by high-yaw faces are dissolved."""
        descriptors = [
            make_desc(CENTRE_A, 0.01), make_desc(CENTRE_A, 0.01),
            make_desc(CENTRE_B, 0.01), make_desc(CENTRE_B, 0.01),
        ]
        ids = [10, 11, 20, 21]
        pose_yaws = [60.0, 65.0, 70.0, 75.0]  # all high-yaw

        result = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2,
            anchor_only_frontal=True, pose_yaws=pose_yaws
        )

        assert result == [], f"Expected no clusters, got {result}"

    def test_high_yaw_face_joins_frontal_cluster(self):
        """A high-yaw face within eps of a frontal cluster is retained as a member."""
        # face 0 (frontal) and face 1 (high-yaw) are close together — form one cluster
        # face 2 (frontal) is far away, forms no cluster on its own
        descriptors = [
            make_desc(CENTRE_A, 0.01),  # id=10, frontal
            make_desc(CENTRE_A, 0.01),  # id=11, high-yaw — but close to CENTRE_A
            make_desc(CENTRE_B, 0.01),  # id=20, frontal — isolated (only 1 face here)
        ]
        ids = [10, 11, 20]
        pose_yaws = [0.0, 60.0, 0.0]  # 10 frontal, 11 high-yaw, 20 frontal

        # min_samples=2 means {10,11} can form a cluster (2 faces within eps)
        result = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2,
            anchor_only_frontal=True, pose_yaws=pose_yaws
        )

        flat = [id for cluster in result for id in cluster]
        # The cluster {10, 11} is valid: face 10 is frontal → anchors it
        assert 10 in flat, "Frontal face should be in a cluster"
        assert 11 in flat, "High-yaw face should join the frontal-anchored cluster"
        # Face 20 is alone → noise
        assert 20 not in flat, "Isolated face should not form a cluster"

    def test_no_pose_yaws_provided_falls_back_to_all_frontal(self):
        """If pose_yaws is None with anchor_only_frontal=True, treat all as frontal."""
        descriptors = [
            make_desc(CENTRE_A, 0.01), make_desc(CENTRE_A, 0.01),
        ]
        ids = [1, 2]

        result = faces.cluster_faces_dbscan(
            descriptors, ids, eps=0.2, min_samples=2,
            anchor_only_frontal=True, pose_yaws=None
        )

        # Should form 1 cluster (fallback: all treated as frontal)
        assert len(result) == 1
        assert set(result[0]) == {1, 2}


# ---------------------------------------------------------------------------
# Command-layer integration: cluster_faces payload wires anchor_only_frontal
# ---------------------------------------------------------------------------

class TestClusterFacesCommandAnchorFlag:

    def _make_face(self, face_id: int, base: list, pose_yaw: float) -> dict:
        desc = make_desc(base, 0.01)
        return {'id': face_id, 'descriptor': desc, 'pose_yaw': pose_yaw}

    def test_anchor_only_frontal_in_payload_dissolves_high_yaw_clusters(self):
        """Command layer honours anchor_only_frontal=True via payload field."""
        payload = {
            'faces': [
                self._make_face(1, CENTRE_A, 60.0),
                self._make_face(2, CENTRE_A, 65.0),
                self._make_face(3, CENTRE_B, 70.0),
                self._make_face(4, CENTRE_B, 75.0),
            ],
            'eps': 0.2,
            'min_samples': 2,
            'anchor_only_frontal': True,
        }

        result = cluster_faces(payload)

        assert result['clusters'] == [], (
            f"Expected no clusters when all faces are high-yaw, got {result['clusters']}"
        )

    def test_anchor_only_frontal_false_allows_high_yaw_clusters(self):
        """anchor_only_frontal=False (default) does not dissolve high-yaw clusters."""
        payload = {
            'faces': [
                self._make_face(1, CENTRE_A, 60.0),
                self._make_face(2, CENTRE_A, 65.0),
            ],
            'eps': 0.2,
            'min_samples': 2,
            'anchor_only_frontal': False,
        }

        result = cluster_faces(payload)

        assert len(result['clusters']) == 1, (
            f"Expected 1 cluster when anchor_only_frontal=False, got {result['clusters']}"
        )
