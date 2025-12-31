import sys
import logging
import numpy as np
from .utils import get_torch

logger = logging.getLogger('ai_engine.faces')

# --- GLOBALS & CONFIG ---
app = None
AI_MODE = "CPU"
CURRENT_PROVIDERS = None
ALLOWED_MODULES = None

# Default Config
DET_THRESH = 0.5

def init_insightface(providers=None, ctx_id=0, allowed_modules=None, det_size=(1280, 1280), det_thresh=None):
    global app, AI_MODE, CURRENT_PROVIDERS, ALLOWED_MODULES
    
    if det_thresh is None:
        det_thresh = DET_THRESH
    
    # OPTIMIZATION: Default to only essential modules to prevent GPU crashes in auxiliary models (3d landmarks)
    if allowed_modules is None:
        allowed_modules = ['detection', 'recognition']

    logger.info(f"Initializing InsightFace with ctx_id={ctx_id}, modules={allowed_modules}, det_size={det_size}...")
    
    # [OPTIMIZATION] Avoid re-initializing if already loaded with same config (simplified check)
    if app is not None:
        try:
             app.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
             return
        except Exception as e:
             logger.warning(f"Failed to re-prepare existing app (will re-init): {e}")

    try:
        from contextlib import redirect_stdout
        from insightface.app import FaceAnalysis
        
        # We need to know if torch is available for CUDA check
        torch_lib = get_torch()
        
        with redirect_stdout(sys.stderr):
             if providers is None:
                 # Auto-detect logic
                 providers = []
                 # Check for CUDA
                 if torch_lib and torch_lib.cuda.is_available():
                     logger.info("CUDA detected via Torch. Preferring CUDAExecutionProvider.")
                     providers.append('CUDAExecutionProvider')
                 
                 # Check for TensorRT
                 try:
                     import ctypes
                     ctypes.CDLL('nvinfer_10.dll')
                     logger.info("TensorRT libraries found. enabling TensorrtExecutionProvider.")
                     providers.insert(0, 'TensorrtExecutionProvider')
                 except Exception:
                     pass
                 
                 providers.append('CPUExecutionProvider')

             logger.info(f"Initializing FaceAnalysis with Providers: {providers}")
             app = FaceAnalysis(name='buffalo_l', providers=providers, allowed_modules=allowed_modules)
             
             # Prepare
             app.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
             
             # Update Status Globals
             CURRENT_PROVIDERS = providers
             ALLOWED_MODULES = allowed_modules
             
             # Determine Mode String
             if 'CUDAExecutionProvider' in providers and ctx_id >= 0:
                 AI_MODE = "GPU"
             elif allowed_modules is not None:
                 AI_MODE = "SAFE_MODE"
             else:
                 AI_MODE = "CPU"
                 
        logger.info(f"InsightFace initialized. Mode: {AI_MODE}")
    except Exception as e:
        logger.error(f"Failed to init InsightFace: {e}")
        raise e

def calculate_mean_embedding(descriptors):
    """
    Calculates the mean embedding from a list of descriptors.
    descriptors: List of 512-d lists or numpy arrays.
    Returns: 512-d list (mean vector).
    """
    if not descriptors:
        return []
    
    # Convert to numpy array for easy mean calc
    arr = np.array(descriptors)
    mean_vec = np.mean(arr, axis=0)
    
    # Normalize
    norm = np.linalg.norm(mean_vec)
    if norm > 0:
        mean_vec = mean_vec / norm
        
    return mean_vec.tolist()

def cluster_faces_dbscan(descriptors, ids, eps=0.5, min_samples=2):
    """
    Clusters faces using DBSCAN.
    descriptors: List of embedding vectors.
    ids: List of corresponding face/photo IDs to return in clusters.
    Returns: List of clusters, where each cluster is a list of ids.
    """
    if not descriptors:
        return []

    X = np.array(descriptors)
    
    # 1. Normalize Vectors (Critical for Cosine/Euclidean equivalence)
    norm = np.linalg.norm(X, axis=1, keepdims=True)
    norm[norm == 0] = 1e-10
    X = X / norm

    try:
        from sklearn.cluster import DBSCAN
    except ImportError:
        logger.warning("sklearn not found. Clustering disabled.")
        return [] 

    # DBSCAN with parameters tuned for ArcFace (Normalized Euclidean)
    clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='euclidean').fit(X)
    
    labels = clustering.labels_
    
    clusters = {}
    for idx, label in enumerate(labels):
        if label == -1: continue # Noise
        if label not in clusters: clusters[label] = []
        clusters[label].append(ids[idx])
        
    return list(clusters.values())
