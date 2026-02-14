"""
Debug Routes - Endpoints for face detection/recognition troubleshooting.

These endpoints expose internal detection pipeline stages for debugging.
"""

import os
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

logger = logging.getLogger("smart-photo-ai")
router = APIRouter()

# Allowed image extensions for path validation
_ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp', '.heic', '.heif', '.raw', '.cr2', '.nef', '.arw', '.dng'}


def _validate_image_path(image_path: str) -> str:
    """Validate and resolve an image path to prevent path traversal attacks."""
    resolved = Path(image_path).resolve()
    if not resolved.suffix.lower() in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Invalid file type: {resolved.suffix}")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return str(resolved)


# --- Request/Response Models ---

class DetectFacesRequest(BaseModel):
    """Request model for face detection."""
    imagePath: str
    returnEmbeddings: bool = False
    detectionThreshold: Optional[float] = None


class VlmVerifyRequest(BaseModel):
    """Request model for VLM face verification."""
    imagePath: str
    box: Dict[str, int]  # {x1, y1, x2, y2}


class ConfigUpdateRequest(BaseModel):
    """Request model for config updates."""
    nms: Optional[Dict[str, float]] = None
    detection: Optional[Dict[str, Any]] = None
    vlm: Optional[Dict[str, Any]] = None


class NmsAnalysisRequest(BaseModel):
    """Request model for NMS analysis."""
    imagePath: str


# --- Endpoints ---

@router.post("/detect-faces")
async def detect_faces(request: DetectFacesRequest):
    """
    Run face detector and return raw boxes + NMS output.

    This bypasses the normal scan pipeline to show intermediate results.

    Returns:
        - raw_detections: Boxes before NMS
        - nms_detections: Boxes after NMS
        - final_faces: Processed face data
    """
    from facelib import faces, nms
    import cv2

    safe_path = _validate_image_path(request.imagePath)

    try:
        # Initialize detector if needed
        if faces.app is None:
            faces.init_insightface()

        # Load image
        img = cv2.imread(safe_path)
        if img is None:
            raise HTTPException(status_code=400, detail="Failed to load image")
        
        # Override threshold if provided
        original_thresh = faces.DET_THRESH
        if request.detectionThreshold:
            faces.DET_THRESH = request.detectionThreshold
            if faces.app:
                faces.app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=faces.DET_THRESH)
        
        try:
            # Run detection
            detected_faces = faces.app.get(img)
            
            # Format raw detections
            raw_detections = []
            for face in detected_faces:
                box = face.bbox.astype(int).tolist()
                raw_detections.append({
                    "box": {"x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3]},
                    "score": float(face.det_score),
                    "pose": {
                        "yaw": float(face.pose[1]) if hasattr(face, "pose") and face.pose is not None else None,
                        "pitch": float(face.pose[0]) if hasattr(face, "pose") and face.pose is not None else None,
                        "roll": float(face.pose[2]) if hasattr(face, "pose") and face.pose is not None else None,
                    }
                })
            
            # Prepare response
            response = {
                "success": True,
                "image_size": {"width": img.shape[1], "height": img.shape[0]},
                "detection_threshold": faces.DET_THRESH,
                "raw_count": len(raw_detections),
                "raw_detections": raw_detections,
            }
            
            # Add embeddings if requested
            if request.returnEmbeddings:
                for i, face in enumerate(detected_faces):
                    if hasattr(face, "embedding") and face.embedding is not None:
                        response["raw_detections"][i]["embedding_dims"] = len(face.embedding)
            
            return response
            
        finally:
            # Restore original threshold
            if request.detectionThreshold:
                faces.DET_THRESH = original_thresh
                if faces.app:
                    faces.app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=faces.DET_THRESH)
                    
    except Exception as e:
        logger.exception("detect-faces error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/vlm-verify")
async def vlm_verify(request: VlmVerifyRequest):
    """
    Run VLM semantic verification on a face region.
    
    Returns:
        - is_face: Whether the region contains a human face
        - confidence: VLM confidence score
        - reason: Explanation from VLM
    """
    from facelib import vlm

    safe_path = _validate_image_path(request.imagePath)

    try:
        result = vlm.verify_is_face(safe_path, request.box)
        return {
            "success": True,
            **result
        }
    except Exception as e:
        logger.exception("vlm-verify error")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_config():
    """
    Get current AI configuration.
    
    Returns all active thresholds and settings.
    """
    from facelib import faces, vlm
    from config import AI_CONFIG
    
    return {
        "detection": {
            "threshold": faces.DET_THRESH if hasattr(faces, "DET_THRESH") else None,
            "model": "buffalo_l",
        },
        "nms": {
            "iou_threshold": AI_CONFIG.get('face_detection', {}).get('nms_iou_threshold', 0.45),
        },
        "vlm": {
            "enabled": vlm.VLM_ENABLED if hasattr(vlm, "VLM_ENABLED") else False,
            "temperature": vlm.VLM_TEMP if hasattr(vlm, "VLM_TEMP") else 0.1,
            "max_tokens": vlm.VLM_MAX_TOKENS if hasattr(vlm, "VLM_MAX_TOKENS") else 100,
        },
        "ai_mode": faces.AI_MODE if hasattr(faces, "AI_MODE") else "unknown",
    }


@router.post("/config")
async def update_config(request: ConfigUpdateRequest):
    """
    Hot-reload configuration changes.
    
    Changes are applied immediately without restart.
    """
    from facelib import faces, vlm
    from config import AI_CONFIG
    
    changes = []
    
    try:
        if request.detection:
            if "threshold" in request.detection:
                old = faces.DET_THRESH
                faces.DET_THRESH = float(request.detection["threshold"])
                if faces.app:
                    faces.app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=faces.DET_THRESH)
                changes.append(f"detection.threshold: {old} -> {faces.DET_THRESH}")
        
        if request.nms:
            if "iou_threshold" in request.nms:
                old = AI_CONFIG.get('face_detection', {}).get('nms_iou_threshold', 0.45)
                AI_CONFIG.setdefault('face_detection', {})['nms_iou_threshold'] = float(request.nms["iou_threshold"])
                changes.append(f"nms.iou_threshold: {old} -> {AI_CONFIG['face_detection']['nms_iou_threshold']}")
        
        if request.vlm:
            if "temperature" in request.vlm:
                old = vlm.VLM_TEMP
                vlm.VLM_TEMP = float(request.vlm["temperature"])
                changes.append(f"vlm.temperature: {old} -> {vlm.VLM_TEMP}")
            
            if "max_tokens" in request.vlm:
                old = vlm.VLM_MAX_TOKENS
                vlm.VLM_MAX_TOKENS = int(request.vlm["max_tokens"])
                changes.append(f"vlm.max_tokens: {old} -> {vlm.VLM_MAX_TOKENS}")
        
        return {
            "success": True,
            "changes": changes if changes else ["No changes applied"],
        }
        
    except Exception as e:
        logger.exception("config update error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nms-analysis")
async def nms_analysis(request: NmsAnalysisRequest):
    """
    Run NMS analysis and return before/after breakdown.
    
    Shows exactly which boxes were merged and why.
    """
    from facelib import faces, nms
    import cv2

    safe_path = _validate_image_path(request.imagePath)

    try:
        # Initialize detector if needed
        if faces.app is None:
            faces.init_insightface()

        # Load image
        img = cv2.imread(safe_path)
        if img is None:
            raise HTTPException(status_code=400, detail="Failed to load image")
        
        # Run detection
        detected_faces = faces.app.get(img)
        
        # Convert to NMS input format
        boxes_before = []
        for face in detected_faces:
            box = face.bbox.astype(int).tolist()
            boxes_before.append({
                "box": {"x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3]},
                "score": float(face.det_score),
                "embedding": face.embedding.tolist() if hasattr(face, "embedding") and face.embedding is not None else None,
            })
        
        # Run NMS analysis
        if hasattr(nms, "apply_nms_with_analysis"):
            analysis = nms.apply_nms_with_analysis(boxes_before)
        else:
            # Fallback: just show before/after
            analysis = {
                "boxes_before": boxes_before,
                "boxes_after": boxes_before,  # Placeholder
                "merges": [],
                "note": "Detailed NMS analysis not available. Update nms.py to add apply_nms_with_analysis()."
            }
        
        return {
            "success": True,
            "image_size": {"width": img.shape[1], "height": img.shape[0]},
            "before_count": len(boxes_before),
            "after_count": len(analysis.get("boxes_after", boxes_before)),
            **analysis
        }
        
    except Exception as e:
        logger.exception("nms-analysis error")
        raise HTTPException(status_code=500, detail=str(e))
