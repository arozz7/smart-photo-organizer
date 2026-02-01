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
        
        result = faces.cluster_faces_dbscan(descriptors, ids, eps, min_samples, debug=debug)
        
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
