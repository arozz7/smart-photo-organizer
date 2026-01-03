import numpy as np
import pytest
import os
import tempfile
import shutil
from facelib import vector_store

@pytest.fixture
def mock_vector_store_paths(mocker):
    # Create temp directory for index files
    temp_dir = tempfile.mkdtemp()
    index_file = os.path.join(temp_dir, 'vectors.index')
    id_map_file = os.path.join(temp_dir, 'id_map.pkl')
    
    # Mock the global variables in vector_store module
    mocker.patch('facelib.vector_store.index_file', index_file)
    mocker.patch('facelib.vector_store.id_map_file', id_map_file)
    
    # Reset globals
    vector_store.index = None
    vector_store.id_map = {}
    
    yield temp_dir
    
    shutil.rmtree(temp_dir)

def test_add_and_search_vectors(mock_vector_store_paths):
    # 512D vectors (normalized)
    v1 = np.zeros(512)
    v1[0] = 1.0 # Standard basis 0
    
    v2 = np.zeros(512)
    v2[1] = 1.0 # Standard basis 1
    
    # Add to index
    vector_store.add_vectors([v1, v2], [101, 102])
    
    assert vector_store.index.ntotal == 2
    assert vector_store.id_map[0] == 101
    assert vector_store.id_map[1] == 102
    
    # Search for v1
    matches = vector_store.search_index(v1, k=1, threshold=0.1)
    assert len(matches) == 1
    assert matches[0]['id'] == 101
    assert matches[0]['distance'] < 0.001
    
    # Search for something far
    v3 = np.zeros(512)
    v3[2] = 1.0
    matches_far = vector_store.search_index(v3, k=1, threshold=0.1)
    assert len(matches_far) == 0

def test_save_and_reinit_faiss(mock_vector_store_paths):
    # Add and save
    v1 = np.zeros(512)
    v1[0] = 1.0
    vector_store.add_vectors([v1], [500])
    vector_store.save_faiss()
    
    assert os.path.exists(mock_vector_store_paths + "/vectors.index")
    
    # Reset globals and re-init
    vector_store.index = None
    vector_store.id_map = {}
    vector_store.init_faiss()
    
    assert vector_store.index.ntotal == 1
    assert vector_store.id_map[0] == 500

def test_rebuild_index(mock_vector_store_paths):
    # Initial state
    vector_store.add_vectors([[1.0] + [0.0]*511], [1])
    
    # Rebuild from scratch
    new_vectors = [[0.0, 1.0] + [0.0]*510]
    new_ids = [2]
    vector_store.rebuild_index(new_vectors, new_ids)
    
    assert vector_store.index.ntotal == 1
    assert vector_store.id_map[0] == 2
    
    # Verify searching for old vector fails
    old_v = [1.0] + [0.0]*511
    matches = vector_store.search_index(old_v, k=1, threshold=0.1)
    assert len(matches) == 0
