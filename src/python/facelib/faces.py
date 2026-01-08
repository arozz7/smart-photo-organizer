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
LAST_CONFIG = None

# Default Config
DET_THRESH = 0.5

def init_insightface(providers=None, ctx_id=0, allowed_modules=None, det_size=(1280, 1280), det_thresh=None):
    global app, AI_MODE, CURRENT_PROVIDERS, ALLOWED_MODULES
    
    if det_thresh is None:
        det_thresh = DET_THRESH
    
    # OPTIMIZATION: Default to only essential modules to prevent GPU crashes in auxiliary models (3d landmarks)
    if allowed_modules is None:
        allowed_modules = ['detection', 'recognition']

    # [OPTIMIZATION] Avoid re-initializing if already loaded with same config
    global LAST_CONFIG
    current_config = (ctx_id, det_size, det_thresh, allowed_modules)
    
    if app is not None:
        # Check if config matches last used config
        if 'LAST_CONFIG' in globals() and LAST_CONFIG == current_config:
            return # Truly no-op

        try:
             # Only re-prepare if params changed
             logger.info(f"Re-preparing InsightFace with ctx_id={ctx_id}, modules={allowed_modules}...")
             app.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
             LAST_CONFIG = current_config
             return
        except Exception as e:
             logger.warning(f"Failed to re-prepare existing app (will re-init): {e}")

    # Fresh Init starts here
    logger.info(f"Initializing InsightFace with ctx_id={ctx_id}, modules={allowed_modules}, det_size={det_size}...")

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
                 
             LAST_CONFIG = (ctx_id, det_size, det_thresh, allowed_modules)
                 
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

def cluster_faces_dbscan(descriptors, ids, eps=0.5, min_samples=2, debug=False):
    """
    Clusters faces using DBSCAN.
    descriptors: List of embedding vectors.
    ids: List of corresponding face/photo IDs to return in clusters.
    debug: If True, return additional diagnostic info about distances.
    Returns: List of clusters, where each cluster is a list of ids.
             If debug=True, returns dict with 'clusters' and 'debug_info'.
    """
    if not descriptors:
        return {'clusters': [], 'debug_info': None} if debug else []

    X = np.array(descriptors)
    
    # 1. Normalize Vectors (Critical for Cosine/Euclidean equivalence)
    norm = np.linalg.norm(X, axis=1, keepdims=True)
    norm[norm == 0] = 1e-10
    X = X / norm

    try:
        from sklearn.cluster import DBSCAN
        from sklearn.metrics import pairwise_distances
    except ImportError:
        logger.warning("sklearn not found. Clustering disabled.")
        return {'clusters': [], 'debug_info': None} if debug else []

    # Original debug block position - removed to fix UnboundLocalError

    # DBSCAN with parameters tuned for ArcFace (Normalized Euclidean)
    # The input 'eps' is treated as a Cosine Distance threshold (range 0-2, typically 0.4-0.6)
    # But we run DBSCAN with metric='euclidean' on normalized vectors.
    # Conversion: distance_euclidean = sqrt(2 * distance_cosine)
    # So: eps_euclidean = sqrt(2 * eps_cosine)
    import math
    eps_euclidean = math.sqrt(2 * eps)
    
    clustering = DBSCAN(eps=eps_euclidean, min_samples=min_samples, metric='euclidean').fit(X)
    
    labels = clustering.labels_
    
    clusters = {}
    for idx, label in enumerate(labels):
        if label == -1: continue # Noise
        if label not in clusters: clusters[label] = []
        clusters[label].append(ids[idx])
    
    result_clusters = list(clusters.values())
    
    if debug:
        # Build face_to_cluster map (always fast)
        face_to_cluster = {}
        for idx, label in enumerate(labels):
            if label != -1:
                face_to_cluster[ids[idx]] = int(label)
            else:
                face_to_cluster[ids[idx]] = -1  # Noise

        # Compute distance stats (conditional on size)
        n_faces = len(X)
        if n_faces > 5000:
            logger.info(f"Large dataset ({n_faces} faces). Using subsampling for debug stats.")
            indices = np.random.choice(n_faces, 5000, replace=False)
            X_sub = X[indices]
            dist_matrix = pairwise_distances(X_sub, metric='euclidean')
            rows, cols = np.triu_indices(5000, k=1)
            distances = dist_matrix[rows, cols]
            
            scale_factor = (n_faces * (n_faces - 1)) / (5000 * 4999)
            within_eps = int((distances <= eps).sum() * scale_factor)
            outside_eps = int((distances > eps).sum() * scale_factor)
            stats_note = "(Estimated)"
        else:
            dist_matrix = pairwise_distances(X, metric='euclidean')
            rows, cols = np.triu_indices(n_faces, k=1)
            distances = dist_matrix[rows, cols]
            within_eps = int((distances <= eps).sum())
            outside_eps = int((distances > eps).sum())
            stats_note = ""

        min_dist = float(np.min(distances)) if len(distances) > 0 else 0
        max_dist = float(np.max(distances)) if len(distances) > 0 else 0
        mean_dist = float(np.mean(distances)) if len(distances) > 0 else 0

        debug_info = {
            'total_faces': n_faces,
            'distance_stats': {
                'min': f"{min_dist:.4f}",
                'mean': f"{mean_dist:.4f} {stats_note}",
                'max': f"{max_dist:.4f}"
            },
            'pairs_within_eps': f"{within_eps} {stats_note}",
            'pairs_outside_eps': f"{outside_eps} {stats_note}",
            'eps_threshold': eps,
            'cluster_sizes': [len(c) for c in result_clusters],
            'cluster_count': len(result_clusters),
            'noise_count': len(ids) - sum(len(c) for c in result_clusters),
            'face_clusters': face_to_cluster
        }
        
        logger.info(f"[DBSCAN Debug] eps={eps}, faces={len(ids)}, clusters={len(result_clusters)}")
        
        return {'clusters': result_clusters, 'debug_info': debug_info}
        
    return result_clusters


def detect_background_faces(faces_data, centroids, min_photo_appearances=3, max_cluster_size=2, distance_threshold=0.7, eps=0.55, min_samples=2):
    """
    Detect background/noise faces that are likely one-time appearances.
    
    Args:
        faces_data: List of dicts with 'id', 'descriptor', 'photo_id'
        centroids: List of dicts with 'personId', 'name', 'descriptor' (named person centroids)
        min_photo_appearances: Faces appearing in fewer photos are candidates
        max_cluster_size: Clusters of this size or smaller are candidates
        distance_threshold: Faces further than this from any centroid are candidates
        eps: DBSCAN eps parameter
        min_samples: DBSCAN min_samples parameter
        
    Returns:
        Dict with 'candidates' list and 'stats' dict
    """
    if not faces_data:
        return {'candidates': [], 'stats': {'totalUnnamed': 0, 'singlePhotoCount': 0, 'twoPhotoCount': 0, 'noiseCount': 0}}
    
    # Extract descriptors and ids
    descriptors = [f['descriptor'] for f in faces_data]
    ids = [f['id'] for f in faces_data]
    photo_ids = [f.get('photo_id', 0) for f in faces_data]
    
    # Build id -> face data lookup
    face_lookup = {f['id']: f for f in faces_data}
    
    # 1. Run DBSCAN to get cluster assignments
    X = np.array(descriptors)
    norm = np.linalg.norm(X, axis=1, keepdims=True)
    norm[norm == 0] = 1e-10
    X_normalized = X / norm
    
    try:
        from sklearn.cluster import DBSCAN
        # Convert eps (pseudo-cosine) to Euclidean
        import math
        eps_euclidean = math.sqrt(2 * eps)
        clustering = DBSCAN(eps=eps_euclidean, min_samples=min_samples, metric='euclidean').fit(X_normalized)
        labels = clustering.labels_
    except ImportError:
        logger.warning("sklearn not found. Using individual face analysis only.")
        labels = [-1] * len(ids)
    
    # Build cluster membership: face_id -> cluster_size
    # Optimized to O(N) from O(N*C)
    from collections import Counter
    valid_labels = [l for l in labels if l != -1]
    label_counts = Counter(valid_labels)
    
    cluster_membership = {}
    cluster_sizes = {}
    
    for i, label in enumerate(labels):
        if label == -1: continue
        face_id = ids[i]
        cluster_membership[face_id] = label
        cluster_sizes[face_id] = label_counts[label]
    
    # Singletons get cluster size of 1
    for face_id in ids:
        if face_id not in cluster_sizes:
            cluster_sizes[face_id] = 1
    
    # 2. Count photo appearances per cluster
    # For each cluster, count how many unique photos contain faces from that cluster
    # Faces in a cluster share the cluster's photo count
    photo_counts = {}
    
    # First, build cluster -> photo_ids mapping
    cluster_photos = {}  # label -> set of photo_ids
    for i, face_id in enumerate(ids):
        photo_id = photo_ids[i]
        label = cluster_membership.get(face_id, -1)
        if label != -1:
            if label not in cluster_photos:
                cluster_photos[label] = set()
            cluster_photos[label].add(photo_id)
    
    # Now assign photo_count to each face based on cluster membership
    for i, face_id in enumerate(ids):
        label = cluster_membership.get(face_id, -1)
        if label != -1:
            # Count of unique photos this cluster appears in
            photo_counts[face_id] = len(cluster_photos[label])
        else:
            # Singleton faces appear in exactly 1 photo
            photo_counts[face_id] = 1

    
    # 3. Calculate distance to nearest named person centroid
    nearest_distances = {}
    nearest_names = {}
    
    if centroids:
        centroid_descriptors = np.array([c['descriptor'] for c in centroids])
        centroid_norm = np.linalg.norm(centroid_descriptors, axis=1, keepdims=True)
        centroid_norm[centroid_norm == 0] = 1e-10
        centroid_descriptors_normalized = centroid_descriptors / centroid_norm
        centroid_names = [c.get('name', 'Unknown') for c in centroids]
        
        for i, face_id in enumerate(ids):
            face_vec = X_normalized[i].reshape(1, -1)
            distances = np.linalg.norm(centroid_descriptors_normalized - face_vec, axis=1)
            min_idx = np.argmin(distances)
            nearest_distances[face_id] = float(distances[min_idx])
            nearest_names[face_id] = centroid_names[min_idx]
    else:
        # No centroids = all faces are maximally distant
        for face_id in ids:
            nearest_distances[face_id] = 2.0  # Max L2 distance for normalized vectors
            nearest_names[face_id] = None
    
    # 4. Filter candidates meeting ALL criteria
    candidates = []
    single_photo_count = 0
    two_photo_count = 0
    
    for face_id in ids:
        pc = photo_counts[face_id]
        cs = cluster_sizes.get(face_id, 1)
        dist = nearest_distances.get(face_id, 2.0)
        
        if pc == 1:
            single_photo_count += 1
        elif pc == 2:
            two_photo_count += 1
        
        # Apply ALL criteria (conservative)
        if pc < min_photo_appearances and cs <= max_cluster_size and dist > distance_threshold:
            face_data = face_lookup.get(face_id, {})
            candidates.append({
                'faceId': face_id,
                'photoCount': pc,
                'clusterSize': cs,
                'nearestPersonDistance': round(dist, 4),
                'nearestPersonName': nearest_names.get(face_id),
                'photo_id': face_data.get('photo_id'),
                'box_json': face_data.get('box_json'),
                'file_path': face_data.get('file_path'),
                'preview_cache_path': face_data.get('preview_cache_path'),
                'width': face_data.get('width'),
                'height': face_data.get('height')
            })
    
    # Sort by distance (furthest from anyone first)
    candidates.sort(key=lambda x: x['nearestPersonDistance'], reverse=True)
    
    return {
        'candidates': candidates,
        'stats': {
            'totalUnnamed': len(ids),
            'singlePhotoCount': single_photo_count,
            'twoPhotoCount': two_photo_count,
            'noiseCount': len(candidates)
        }
    }
