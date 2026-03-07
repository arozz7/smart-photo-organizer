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

# [Phase 61] Model Caching
# Cache up to 4 model instances (enough for Standard + Macro + TTA variants)
# Key: (ctx_id, det_size, det_thresh, nms_thresh, tuple(allowed_modules))
# Value: FaceAnalysis instance
APP_CACHE = {}
MAX_CACHE_SIZE = 4

# Default Config
DET_THRESH = 0.7 # Increased further to eliminate background noise (windows/patterns)
NMS_THRESH = 0.65 # High overlap allowed

def clear_model_cache():
    """Clear the model cache to free VRAM"""
    global APP_CACHE, app
    logger.info(f"Clearing model cache ({len(APP_CACHE)} items)...")
    APP_CACHE.clear()
    app = None
    import gc
    gc.collect()

def init_insightface(providers=None, ctx_id=0, allowed_modules=None, det_size=(1280, 1280), det_thresh=None, nms_thresh=None):
    global app, AI_MODE, CURRENT_PROVIDERS, ALLOWED_MODULES, APP_CACHE
    
    if det_thresh is None:
        det_thresh = DET_THRESH
        
    if nms_thresh is None:
        nms_thresh = NMS_THRESH
    
    # OPTIMIZATION: Default to only essential modules to prevent GPU crashes in auxiliary models (3d landmarks)
    # NOTE: genderage module added for age-based ERA categorization
    if allowed_modules is None:
        allowed_modules = ['detection', 'recognition', 'landmark_2d_106', 'landmark_3d_68', 'genderage']

    # [OPTIMIZATION] Check Cache
    # Use tuple for specific config including thresh (as it's baked into model params)
    config_key = (ctx_id, det_size[0], det_size[1], det_thresh, nms_thresh, tuple(sorted(allowed_modules)))
    
    if config_key in APP_CACHE:
        # Cache Hit
        if app != APP_CACHE[config_key]:
            logger.debug(f"Model Cache HIT for size {det_size} / thresh {det_thresh}. Switching instance.")
            app = APP_CACHE[config_key]
        return

    logger.info(f"Model Cache MISS. Initializing for size {det_size}...")

    # [Fix] InsightFace's RetinaFace model refuses to update input_size (det_size) after first init.
    # We must force a fresh instance if det_size changes (which is handled by cache miss logic now).
    
    # Fresh Init starts here
    # ----------------------
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

             # Validate landmark data files before init to catch packaging issues early
             if 'landmark_3d_68' in allowed_modules:
                 from insightface.data import get_object
                 if get_object('meanshape_68.pkl') is None:
                     logger.warning("meanshape_68.pkl not found — landmark_3d_68 will fail. "
                                    "Falling back to landmark_2d_106 only. "
                                    "Rebuild with '--collect-data insightface' to fix.")
                     allowed_modules = [m for m in allowed_modules if m != 'landmark_3d_68']

             new_app = FaceAnalysis(name='buffalo_l', providers=providers, allowed_modules=allowed_modules)

             # Prepare
             new_app.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
             if hasattr(new_app, 'det_model'):
                 new_app.det_model.nms_thresh = nms_thresh
             
             # Store in Cache
             if len(APP_CACHE) >= MAX_CACHE_SIZE:
                 # Simple LRU-ish: Remove first key
                 first_key = next(iter(APP_CACHE))
                 del APP_CACHE[first_key]
                 
             APP_CACHE[config_key] = new_app
             app = new_app
             
             CURRENT_PROVIDERS = providers
             ALLOWED_MODULES = allowed_modules
             
             if 'CUDAExecutionProvider' in providers and ctx_id >= 0:
                 AI_MODE = "GPU"
             elif allowed_modules is not None:
                 AI_MODE = "SAFE_MODE"
             else:
                 AI_MODE = "CPU"
             
             logger.info(f"InsightFace initialized. Mode: {AI_MODE}")
             
    except Exception as e:
        logger.error(f"Failed to init InsightFace: {e}")
        import traceback
        traceback.print_exc()

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

def split_oversized_cluster(cluster_ids, X_normalized, id_to_idx, max_size=25):
    """
    Split a large cluster into smaller sub-clusters using hierarchical clustering.
    ALWAYS splits clusters larger than max_size - no cohesion exception.
    
    Args:
        cluster_ids: List of face IDs in the cluster
        X_normalized: Full normalized embedding matrix (all faces)
        id_to_idx: Dict mapping face ID to index in X_normalized
        max_size: Maximum allowed cluster size
        
    Returns:
        List of sub-cluster ID lists, each with size ≤ max_size
    """
    if len(cluster_ids) <= max_size:
        return [cluster_ids]
    
    try:
        from scipy.cluster.hierarchy import linkage, fcluster
    except ImportError:
        logger.warning("scipy not found. Skipping cluster splitting.")
        return [cluster_ids]
    
    # Extract embeddings for this cluster
    indices = [id_to_idx[fid] for fid in cluster_ids]
    X_sub = X_normalized[indices]
    
    # Ward's method for balanced clusters
    Z = linkage(X_sub, method='ward')
    
    # Split into 2 initially
    labels = fcluster(Z, t=2, criterion='maxclust')
    
    # Group IDs by sub-cluster label
    sub_clusters = {}
    for i, label in enumerate(labels):
        if label not in sub_clusters:
            sub_clusters[label] = []
        sub_clusters[label].append(cluster_ids[i])
    
    # RECURSIVELY split any sub-clusters that are still too large
    final_clusters = []
    for sub_ids in sub_clusters.values():
        if len(sub_ids) > max_size:
            deeper_split = split_oversized_cluster(sub_ids, X_normalized, id_to_idx, max_size)
            final_clusters.extend(deeper_split)
        else:
            final_clusters.append(sub_ids)
    
    return final_clusters


def cluster_faces_dbscan(
    descriptors,
    ids,
    eps=0.5,
    min_samples=2,
    debug=False,
    anchor_only_frontal: bool = False,
    pose_yaws=None,
):
    """
    Clusters faces using DBSCAN.

    descriptors: List of embedding vectors.
    ids: List of corresponding face/photo IDs to return in clusters.
    debug: If True, return additional diagnostic info about distances.
    anchor_only_frontal: When True, clusters that contain no frontal face
        (|pose_yaw| < 55°) are dissolved. High-yaw faces can join a cluster
        started by a frontal face but cannot anchor one on their own.
        Requires pose_yaws to be provided; if None, all faces are treated as
        frontal (safe fallback).
    pose_yaws: List of yaw angles (degrees) parallel to ids/descriptors.
        Only used when anchor_only_frontal=True.
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
    
    logger.info(f"[DBSCAN] Input eps (cosine)={eps}, converted eps_euclidean={eps_euclidean:.4f}, min_samples={min_samples}, n_faces={len(ids)}")
    
    # Debug: Check pairwise distance stats (sample for large datasets)
    from sklearn.metrics import pairwise_distances
    n_sample = min(50, len(X))
    sample_dists = pairwise_distances(X[:n_sample], metric='euclidean')
    sample_dists_upper = sample_dists[np.triu_indices(n_sample, k=1)]
    if len(sample_dists_upper) > 0:
        logger.info(f"[DBSCAN] Sample distances (first {n_sample} faces): min={sample_dists_upper.min():.4f}, mean={sample_dists_upper.mean():.4f}, max={sample_dists_upper.max():.4f}")
    
    clustering = DBSCAN(eps=eps_euclidean, min_samples=min_samples, metric='euclidean').fit(X)
    
    labels = clustering.labels_
    
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = list(labels).count(-1)
    logger.info(f"[DBSCAN] Result: {n_clusters} clusters, {n_noise} noise points")
    
    clusters = {}
    for idx, label in enumerate(labels):
        if label == -1: continue # Noise
        if label not in clusters: clusters[label] = []
        clusters[label].append(ids[idx])
    
    result_clusters = list(clusters.values())

    # Phase 104 — Pose-weighted anchor filter
    # Dissolve any cluster whose members are all high-yaw (no frontal anchor).
    if anchor_only_frontal:
        FRONTAL_YAW_LIMIT = 55.0
        if pose_yaws is not None:
            id_to_yaw = {face_id: yaw for face_id, yaw in zip(ids, pose_yaws)}
            def has_frontal_anchor(cluster):
                return any(abs(id_to_yaw.get(fid, 0.0)) < FRONTAL_YAW_LIMIT for fid in cluster)
            result_clusters = [c for c in result_clusters if has_frontal_anchor(c)]
        # If pose_yaws is None, treat all faces as frontal → no filtering applied

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


def find_ungroupable_faces(face_ids, descriptors, centroids, distance_threshold=1.0):
    """
    Identify faces that are too far from any named person to ever be matched.
    
    Args:
        face_ids: List of face IDs
        descriptors: List of face descriptor vectors (512-dim)
        centroids: List of dicts with 'descriptor' and 'name' keys for named people
        distance_threshold: Max L2 distance (normalized) to nearest centroid (default 1.0)
    
    Returns:
        dict with:
            - ungroupable_ids: List of face IDs exceeding threshold
            - groupable_ids: List of face IDs within threshold
            - stats: Summary statistics
    """
    if not descriptors or not face_ids:
        return {'ungroupable_ids': [], 'groupable_ids': [], 'stats': {'total': 0}}
    
    # Convert to numpy and normalize
    X = np.array(descriptors)
    norm = np.linalg.norm(X, axis=1, keepdims=True)
    norm[norm == 0] = 1e-10
    X_normalized = X / norm
    
    ungroupable_ids = []
    groupable_ids = []
    distances = []
    
    if not centroids or len(centroids) == 0:
        # No centroids = all faces are ungroupable
        logger.info(f"[Ungroupable] No named person centroids. All {len(face_ids)} faces are ungroupable.")
        return {
            'ungroupable_ids': list(face_ids),
            'groupable_ids': [],
            'stats': {
                'total': len(face_ids),
                'ungroupable': len(face_ids),
                'groupable': 0,
                'threshold': distance_threshold,
                'centroidCount': 0
            }
        }
    
    # Prepare centroids
    centroid_descriptors = np.array([c['descriptor'] for c in centroids])
    centroid_norm = np.linalg.norm(centroid_descriptors, axis=1, keepdims=True)
    centroid_norm[centroid_norm == 0] = 1e-10
    centroid_descriptors_normalized = centroid_descriptors / centroid_norm
    
    # Calculate nearest distance for each face
    for i, face_id in enumerate(face_ids):
        face_vec = X_normalized[i].reshape(1, -1)
        dists = np.linalg.norm(centroid_descriptors_normalized - face_vec, axis=1)
        min_dist = float(np.min(dists))
        distances.append(min_dist)
        
        if min_dist > distance_threshold:
            ungroupable_ids.append(face_id)
        else:
            groupable_ids.append(face_id)
    
    logger.info(f"[Ungroupable] Threshold {distance_threshold}: {len(ungroupable_ids)} ungroupable, {len(groupable_ids)} groupable")
    
    return {
        'ungroupable_ids': ungroupable_ids,
        'groupable_ids': groupable_ids,
        'stats': {
            'total': len(face_ids),
            'ungroupable': len(ungroupable_ids),
            'groupable': len(groupable_ids),
            'threshold': distance_threshold,
            'centroidCount': len(centroids),
            'meanDistance': float(np.mean(distances)) if distances else 0,
            'maxDistance': float(np.max(distances)) if distances else 0
        }
    }


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
