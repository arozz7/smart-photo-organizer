"""
FAISS vector index commands.

This module contains commands for managing the FAISS vector index.
Extracted from main.py for file size compliance.
"""

import logging
import json
import os

# Import shared modules
import facelib.vector_store as vector_store

logger = logging.getLogger('ai_engine.index')


def rebuild_index(payload, req_id=None):
    """
    Rebuild the FAISS index with new descriptors and IDs.
    
    Args:
        payload: Command payload with descriptors, ids, or dataPath
        req_id: Request ID for response tracking
    
    Returns:
        dict: Rebuild result with count and success status
    """
    descriptors = payload.get('descriptors', [])
    ids = payload.get('ids', [])
    
    # Support file-based payload for large datasets
    if 'dataPath' in payload:
         dpath = payload['dataPath']
         if os.path.exists(dpath):
             try:
                 logger.info(f"Loading rebuild data from {dpath}...")
                 with open(dpath, 'r') as f:
                     file_payload = json.load(f)
                     # Expecting {"faces": [{"id": 1, "descriptor": [...]}, ...]}
                     # OR {"descriptors": [...], "ids": [...]}
                     if 'faces' in file_payload:
                         descriptors = [x['descriptor'] for x in file_payload['faces']]
                         ids = [x['id'] for x in file_payload['faces']]
                     else:
                         descriptors = file_payload.get('descriptors', descriptors)
                         ids = file_payload.get('ids', ids)
             except Exception as e:
                 logger.error(f"Failed to read data path: {e}")

    logger.info(f"Rebuilding FAISS index with {len(descriptors)} vectors...")
    try:
        count = vector_store.rebuild_index(descriptors, ids)
        response = {"type": "rebuild_index_result", "count": count, "success": True, "reqId": req_id}
    except Exception as e:
        logger.exception("Index rebuild failed")
        response = {"error": str(e), "reqId": req_id}
    
    return response


def search_index(payload, req_id=None):
    """
    Search the FAISS index for similar faces.
    
    Args:
        payload: Command payload with descriptor, k, threshold
        req_id: Request ID for response tracking
    
    Returns:
        dict: Search result with matches
    """
    descriptor = payload.get('descriptor')
    k = payload.get('k', 10)
    threshold = payload.get('threshold', 0.6)
    try:
        matches = vector_store.search_index(descriptor, k, threshold)
        response = {"type": "search_result", "matches": matches, "reqId": req_id}
    except Exception as e:
        logger.exception("Search failed")
        response = {"error": str(e), "reqId": req_id}
    
    return response


def batch_search_index(payload, req_id=None):
    """
    Batch search the FAISS index for multiple descriptors.
    
    Args:
        payload: Command payload with descriptors, k, threshold
        req_id: Request ID for response tracking
    
    Returns:
        dict: Batch search result with results array
    """
    descriptors = payload.get('descriptors', [])
    k = payload.get('k', 10)
    threshold = payload.get('threshold', 0.6)
    try:
        results = vector_store.search_index_batch(descriptors, k, threshold)
        response = {"type": "batch_search_result", "results": results, "reqId": req_id}
    except Exception as e:
        logger.exception("Batch search failed")
        response = {"error": str(e), "reqId": req_id}
    
    return response
