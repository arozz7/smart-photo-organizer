import numpy as np
import pytest
from facelib import faces

def test_calculate_mean_embedding():
    # 2 simple 2D vectors (for testing concepts, arcface uses 512D)
    v1 = [1.0, 0.0]
    v2 = [0.0, 1.0]
    
    # Mean: [0.5, 0.5]
    # Norm: sqrt(0.5^2 + 0.5^2) = sqrt(0.5) = 0.707...
    # Normalized: [0.5/0.707, 0.5/0.707] = [0.707, 0.707]
    
    mean_vec = faces.calculate_mean_embedding([v1, v2])
    
    assert len(mean_vec) == 2
    assert pytest.approx(mean_vec[0], 0.01) == 0.707
    assert pytest.approx(mean_vec[1], 0.01) == 0.707

def test_calculate_mean_embedding_empty():
    assert faces.calculate_mean_embedding([]) == []

def test_cluster_faces_dbscan():
    # 2 distinct clusters
    # Cluster A: centered at [1, 0]
    # Cluster B: centered at [0, 1]
    descriptors = [
        [1.0, 0.01], [1.0, -0.01], # A
        [0.01, 1.0], [-0.01, 1.0], # B
        [0.5, 0.5] # Noise (far from both)
    ]
    ids = [10, 11, 20, 21, 99]
    
    # eps=0.2 should separate them
    clusters = faces.cluster_faces_dbscan(descriptors, ids, eps=0.2, min_samples=2)
    
    assert len(clusters) == 2
    # Verify contents (order might vary)
    flat_clusters = [set(c) for c in clusters]
    assert {10, 11} in flat_clusters
    assert {20, 21} in flat_clusters
    # Noise [99] should NOT be in any cluster
    all_ids = [id for c in clusters for id in c]
    assert 99 not in all_ids

def test_cluster_faces_dbscan_empty():
    assert faces.cluster_faces_dbscan([], []) == []
