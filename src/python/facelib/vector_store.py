import os
import pickle
import logging
import numpy as np
from .utils import LIBRARY_PATH, get_faiss

logger = logging.getLogger('ai_engine.vector_store')

# --- GLOBALS ---
index = None # FAISS
id_map = {} # FAISS ID Map

# Paths
index_file = os.path.join(LIBRARY_PATH, 'vectors.index')
id_map_file = os.path.join(LIBRARY_PATH, 'id_map.pkl')

def init_faiss():
    global index, id_map
    logger.info("Initializing FAISS...")
    faiss_lib = get_faiss()
    if not faiss_lib:
        logger.warning("FAISS library not loaded. Vector search will be disabled.")
        return

    try:
        if os.path.exists(index_file):
            index = faiss_lib.read_index(index_file)
            if os.path.exists(id_map_file):
                with open(id_map_file, 'rb') as f:
                    id_map = pickle.load(f)
            logger.info(f"Loaded existing index with {index.ntotal} vectors.")
        else:
            index = faiss_lib.IndexFlatL2(512)
            logger.info("Created new FAISS index (512d).")
    except Exception as e:
        logger.error(f"Failed to init FAISS: {e}")
        index = faiss_lib.IndexFlatL2(512)

def save_faiss():
    faiss_lib = get_faiss()
    if index and faiss_lib:
        logger.info("Saving FAISS index to disk...")
        faiss_lib.write_index(index, index_file)
        with open(id_map_file, 'wb') as f:
            pickle.dump(id_map, f)

def add_vectors(vectors, ids):
    """
    Adds vectors to the index and updates id_map.
    vectors: List of descriptors (lists or numpy arrays).
    ids: List of corresponding IDs.
    Returns: count of added vectors on success.
    """
    faiss_lib = get_faiss()
    if not faiss_lib: raise ImportError("FAISS not available")
    
    global index, id_map
    if index is None:
        init_faiss()
    
    # Normalize
    X = np.array(vectors).astype('float32')
    faiss_lib.normalize_L2(X)
    
    start_idx = index.ntotal
    index.add(X)
    
    # Update ID Map
    for i, face_db_id in enumerate(ids):
        id_map[start_idx + i] = face_db_id
        
    return len(vectors)

def search_index(descriptor, k=10, threshold=0.6):
    """
    Searches the index for a descriptor.
    Returns: List of matches [{"id":..., "distance":...}]
    """
    faiss_lib = get_faiss()
    
    if not faiss_lib: return []
    
    if descriptor is None or index is None or index.ntotal == 0:
        return []

    X = np.array([descriptor]).astype('float32')
    faiss_lib.normalize_L2(X)
    distances, indices = index.search(X, k)
    
    # Results

    matches = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx == -1: continue
        if dist > threshold: continue
        face_id = id_map.get(int(idx))
        if face_id is not None:
            matches.append({"id": face_id, "distance": float(dist)})
            
    return matches

def search_index_batch(descriptors, k=10, threshold=0.6):
    """
    Searches the index for a batch of descriptors.
    descriptors: List of lists/arrays (batch_size, dim)
    Returns: List of Lists of matches
    """
    faiss_lib = get_faiss()
    if not faiss_lib: return [[] for _ in descriptors]
    
    if descriptors is None or len(descriptors) == 0 or index is None or index.ntotal == 0:
        return [[] for _ in descriptors] if descriptors is not None else []

    X = np.array(descriptors).astype('float32')
    faiss_lib.normalize_L2(X)
    
    # Batch Search
    D, I = index.search(X, k)
    
    results = []
    
    for i in range(len(descriptors)):
        matches = []
        distances = D[i]
        indices = I[i]
        
        for dist, idx in zip(distances, indices):
            if idx == -1: continue
            if dist > threshold: continue
            
            face_id = id_map.get(int(idx))
            if face_id is not None:
                matches.append({"id": face_id, "distance": float(dist)})
        
        results.append(matches)
            
    return results

def rebuild_index(descriptors, ids):
    """
    Rebuilds the index from scratch.
    [Phase 60] Hybrid Strategy:
    - N < 2000: IndexFlatL2 (Brute Force, Fast start)
    - N >= 2000: IndexIVFFlat (Clustered, Scalable to 500k+)
    """
    faiss_lib = get_faiss()
    if not faiss_lib: raise ImportError("FAISS not available")
    
    global index, id_map
    
    n_total = len(descriptors)
    d = 512
    
    # [Phase 60] Hybrid Selection Logic
    if n_total >= 2000:
        logger.info(f"Rebuilding Index: Using IndexIVFFlat (N={n_total})")
        # Calc nlist (clusters): 4 * sqrt(N), min 32, max 4096
        nlist = int(4 * np.sqrt(n_total))
        nlist = max(32, min(nlist, 4096))
        
        quantizer = faiss_lib.IndexFlatL2(d)
        new_index = faiss_lib.IndexIVFFlat(quantizer, d, nlist, faiss_lib.METRIC_L2)
        
        # Train
        X = np.array(descriptors).astype('float32')
        faiss_lib.normalize_L2(X)
        logger.info(f"Training IVF Index with {nlist} clusters...")
        new_index.train(X)
    else:
        logger.info(f"Rebuilding Index: Using IndexFlatL2 (N={n_total})")
        new_index = faiss_lib.IndexFlatL2(d)
        X = np.array(descriptors).astype('float32') if descriptors else np.empty((0, d), dtype='float32')
        if len(X) > 0:
            faiss_lib.normalize_L2(X)
            
    new_id_map = {}
    
    if len(X) > 0:
        new_index.add(X)
        for i, face_id in enumerate(ids):
            new_id_map[i] = face_id
            
    index = new_index
    id_map = new_id_map
    save_faiss()
    return index.ntotal
