"""
Face clustering commands using DBSCAN.

This module contains commands for clustering faces by their embeddings.
Extracted from main.py for file size compliance.
"""

import logging
import json
import os
import numpy as np

# Import shared modules
import facelib.faces as faces

logger = logging.getLogger('ai_engine.clustering')


def cluster_faces(payload, req_id=None):
    """
    Cluster faces using DBSCAN algorithm.
    
    Args:
        payload: Command payload with faces data, eps, min_samples, max_size
        req_id: Request ID for response tracking
    
    Returns:
        dict: Clustering result with clusters, singles, and debug info
    """
    faces_data = payload.get('faces', [])
    if 'dataPath' in payload:
         dpath = payload['dataPath']
         if os.path.exists(dpath):
             try:
                 with open(dpath, 'r') as f:
                     file_payload = json.load(f)
                     faces_data = file_payload.get('faces', [])
             except: pass

    logger.info(f"Clustering {len(faces_data)} faces...")
    try:
        descriptors = [f['descriptor'] for f in faces_data]
        ids = [f['id'] for f in faces_data]
        eps = float(payload.get('eps', 0.55))
        min_samples = int(payload.get('min_samples', 2))
        max_size = int(payload.get('max_size', 200)) # Default to 200
        debug = bool(payload.get('debug', False))
        min_cohesion = float(payload.get('min_cohesion', 0.0))
        anchor_only_frontal = bool(payload.get('anchor_only_frontal', False))
        pose_yaws = [f.get('pose_yaw') for f in faces_data] if anchor_only_frontal else None

        result = faces.cluster_faces_dbscan(
            descriptors, ids, eps, min_samples, debug=debug,
            anchor_only_frontal=anchor_only_frontal, pose_yaws=pose_yaws
        )
        
        # Handle both debug (dict) and normal (list) return types
        if isinstance(result, dict):
            cluster_list = result.get('clusters', [])
            debug_info = result.get('debug_info')
        else:
            cluster_list = result
            debug_info = None
        
        # Use normalized descriptors for splitting
        X = np.array(descriptors)
        norm = np.linalg.norm(X, axis=1, keepdims=True)
        norm[norm == 0] = 1e-10
        X_normalized = X / norm
        
        id_to_idx = {fid: idx for idx, fid in enumerate(ids)}
        
        # Split oversized clusters
        final_clusters = []
        for cluster in cluster_list:
            if len(cluster) > max_size:
                logger.info(f"Splitting oversized cluster of size {len(cluster)} (max={max_size})")
                sub_clusters = faces.split_oversized_cluster(cluster, X_normalized, id_to_idx, max_size)
                final_clusters.extend(sub_clusters)
            else:
                final_clusters.append(cluster)
        
        cluster_list = final_clusters

        max_spread = float(payload.get('max_spread', 0.0))

        # Cohesion + spread filter: demote garbage/chain-linked clusters to singles.
        # For L2-normalized descriptors:
        #   - Cohesion (centroid magnitude): same-person cluster ≈ 1.0, random garbage ≈ 0.0
        #   - Spread (max member-to-centroid distance): tight cluster ≈ 0.3-0.6, chain-linked ≈ 1.0+
        # Either failing check demotes the whole cluster to singles.
        if min_cohesion > 0.0 or max_spread > 0.0:
            logger.info(
                f"Cluster quality filter: {len(cluster_list)} clusters, "
                f"min_cohesion={min_cohesion}, max_spread={max_spread}"
            )
            cohesive_clusters = []
            for idx, cluster in enumerate(cluster_list):
                member_idxs = [id_to_idx[fid] for fid in cluster if fid in id_to_idx]
                if not member_idxs:
                    continue
                cluster_descriptors = X_normalized[member_idxs]
                centroid = np.mean(cluster_descriptors, axis=0)
                magnitude = float(np.linalg.norm(centroid))

                # Spread: max euclidean distance from any member to the centroid
                distances = np.linalg.norm(cluster_descriptors - centroid, axis=1)
                spread = float(np.max(distances))

                logger.info(
                    f"  Cluster {idx}: size={len(cluster)}, "
                    f"magnitude={magnitude:.3f}, spread={spread:.3f}"
                )

                if min_cohesion > 0.0 and magnitude < min_cohesion:
                    logger.info(
                        f"  -> DEMOTED (magnitude {magnitude:.3f} < {min_cohesion})"
                    )
                    continue
                if max_spread > 0.0 and spread > max_spread:
                    logger.info(
                        f"  -> DEMOTED (spread {spread:.3f} > {max_spread})"
                    )
                    continue
                cohesive_clusters.append(cluster)
            cluster_list = cohesive_clusters

        # Identify singles (all IDs not in flattened cluster list)
        clustered_ids = set([i for c in cluster_list for i in c])
        singles = [i for i in ids if i not in clustered_ids]
        
        # Sort by size
        cluster_list.sort(key=len, reverse=True)
        
        response = {
            "type": "cluster_result", 
            "clusters": cluster_list, 
            "singles": singles, 
            "debug_info": debug_info,
            "reqId": req_id
        }
    except Exception as e:
        logger.error(f"Clustering error: {e}")
        response = {"type": "cluster_result", "error": str(e), "reqId": req_id}
    
    return response
