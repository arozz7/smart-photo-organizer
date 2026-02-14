"""
Status Routes - Production endpoints for backend status and health.

These endpoints provide the foundation for the External Agent API.
"""

import os
import logging
from fastapi import APIRouter

logger = logging.getLogger("smart-photo-ai")
router = APIRouter()


@router.get("/status")
async def get_status():
    """
    Get current backend status.
    
    Returns:
        - status: Current state (idle, scanning, etc.)
        - queue_depth: Number of pending operations
        - uptime: Server uptime in seconds
    """
    import time
    from datetime import datetime
    
    # TODO: Integrate with actual scan state when available
    return {
        "status": "idle",
        "queue_depth": 0,
        "timestamp": datetime.now().isoformat(),
        "mode": os.environ.get("API_MODE", "ipc"),
    }


@router.get("/health")
async def health_check():
    """
    Health check endpoint for monitoring.
    
    Returns:
        - healthy: Overall health status
        - models: Status of loaded AI models
        - gpu: GPU availability and memory
    """
    import sys
    
    health = {
        "healthy": True,
        "python_version": sys.version,
        "models": {},
        "gpu": None,
    }
    
    # Check InsightFace
    try:
        import facelib.faces as faces
        health["models"]["insightface"] = {
            "loaded": faces.app is not None,
            "mode": faces.AI_MODE if hasattr(faces, "AI_MODE") else "unknown"
        }
    except Exception as e:
        health["models"]["insightface"] = {"loaded": False, "error": str(e)}
    
    # Check VLM
    try:
        import facelib.vlm as vlm
        health["models"]["vlm"] = {
            "loaded": vlm.vlm_model is not None if hasattr(vlm, "vlm_model") else False,
            "enabled": vlm.VLM_ENABLED if hasattr(vlm, "VLM_ENABLED") else False
        }
    except Exception as e:
        health["models"]["vlm"] = {"loaded": False, "error": str(e)}
    
    # Check GPU
    try:
        import torch
        if torch.cuda.is_available():
            health["gpu"] = {
                "available": True,
                "device": torch.cuda.get_device_name(0),
                "memory_allocated_mb": round(torch.cuda.memory_allocated(0) / 1024 / 1024, 2),
                "memory_total_mb": round(torch.cuda.get_device_properties(0).total_memory / 1024 / 1024, 2),
            }
        else:
            health["gpu"] = {"available": False}
    except ImportError:
        health["gpu"] = {"available": False, "reason": "torch not installed"}
    except Exception as e:
        health["gpu"] = {"available": False, "error": str(e)}
    
    return health
