"""
Face analysis commands for pose and age extraction.

This module contains commands for extracting face pose, age, and gender data
from face crops. Extracted from main.py for file size compliance.
"""

import time
import logging
import json
import cv2

# Import shared modules
import facelib.faces as faces
import facelib.image_ops as image_ops

logger = logging.getLogger('ai_engine.face_analysis')


def extract_face_pose(payload, load_image_cv2_func, req_id=None):
    """
    Extract pose data (yaw, pitch, roll) for a specific face region.
    
    Args:
        payload: Command payload with filePath, box, faceId, orientation
        load_image_cv2_func: Function to load images (from main.py)
        req_id: Request ID for response tracking
    
    Returns:
        dict: Pose extraction result with yaw, pitch, roll, quality, descriptor
    """
    file_path = payload.get('filePath')
    box = payload.get('box')  # {x, y, width, height}
    face_id = payload.get('faceId')
    
    logger.debug(f"Extracting pose for face {face_id} from {file_path}")
    
    try:
        img = load_image_cv2_func(file_path)
        if img is None:
            response = {"type": "face_pose_result", "success": False, "error": "Image load failed", "faceId": face_id}
        else:
            # Apply Orientation Correction (Match analyze_image logic)
            orientation = payload.get('orientation', 1)
            h_img, w_img = img.shape[:2]
            is_landscape_dims = w_img > h_img
            expects_portrait = (orientation == 6 or orientation == 8)
            
            if expects_portrait and is_landscape_dims:
                if orientation == 6:
                    img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
                elif orientation == 8:
                    img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
            elif orientation == 3:
                 img = cv2.rotate(img, cv2.ROTATE_180)

            # Expand box slightly for better face detection
            x = int(box.get('x', 0))
            y = int(box.get('y', 0))
            w = int(box.get('width', 100))
            h = int(box.get('height', 100))
            
            # Add 100% padding (context is crucial for detection on crops)
            pad_x = int(w * 1.0)
            pad_y = int(h * 1.0)
            x1 = max(0, x - pad_x)
            y1 = max(0, y - pad_y)
            x2 = min(img.shape[1], x + w + pad_x)
            y2 = min(img.shape[0], y + h + pad_y)
            
            face_crop = img[y1:y2, x1:x2]
            
            t_prep = time.time()
            # logger.debug(f"Prep time: {t_prep - t_start:.3f}s")

            if face_crop.size == 0 or face_crop.shape[0] < 10 or face_crop.shape[1] < 10:
                logger.warning(f"Face crop too small/empty for face {face_id}")
                response = {"type": "face_pose_result", "success": False, "error": "Face crop too small", "faceId": face_id}
            else:
                if not faces.app or (faces.ALLOWED_MODULES and 'recognition' not in faces.ALLOWED_MODULES): 
                    faces.init_insightface()
                
                # Run detection on crop
                t_det_start = time.time()
                f_results = faces.app.get(face_crop)
                t_det_end = time.time()
                logger.debug(f"Face {face_id} detection took {t_det_end - t_det_start:.3f}s")
                
                pose_yaw, pose_pitch, pose_roll, face_quality, descriptor_v2 = None, None, None, None, None
                
                if len(f_results) > 0:
                    # Take the largest detected face
                    best_face = max(f_results, key=lambda f: (f.bbox[2]-f.bbox[0]) * (f.bbox[3]-f.bbox[1]))
                    
                    # Extract pose
                     # ... (rest of logic) ...
                    if hasattr(best_face, 'pose') and best_face.pose is not None:
                        try:
                            pose = best_face.pose
                            pose_pitch = float(pose[0]) if len(pose) > 0 else None
                            pose_yaw = float(pose[1]) if len(pose) > 1 else None
                            pose_roll = float(pose[2]) if len(pose) > 2 else None
                        except (TypeError, IndexError):
                            pass
                    
                    # Calculate quality
                    f_blur = image_ops.estimate_blur(face_crop, target_size=112)
                    blur_factor = min(f_blur / 100.0, 1.0) if f_blur else 0.5
                    pose_factor = max(0, 1.0 - (abs(pose_yaw) / 90.0)) if pose_yaw is not None else 0.5
                    det_score = float(best_face.det_score) if hasattr(best_face, 'det_score') else 0.5
                    size_factor = min(w / 200.0, 1.0)
                    face_quality = (blur_factor * 0.3 + pose_factor * 0.3 + det_score * 0.2 + size_factor * 0.2)
                    
                    # Extract descriptor_v2
                    if hasattr(best_face, 'embedding'):
                        if best_face.embedding is not None:
                            try:
                                embedding = best_face.embedding.tolist()
                                norm = sum(e**2 for e in embedding) ** 0.5
                                if norm > 0:
                                    descriptor_v2 = [e / norm for e in embedding]
                                else:
                                    logger.warning(f"[extract_face_pose] Face {face_id}: embedding norm is 0")
                            except Exception as emb_err:
                                logger.warning(f"[extract_face_pose] Embedding extraction failed: {emb_err}")
                        else:
                            logger.warning(f"[extract_face_pose] Face {face_id}: embedding attribute is None. Modules: {faces.ALLOWED_MODULES}")
                    else:
                        logger.warning(f"[extract_face_pose] Face {face_id}: no embedding attribute. Modules: {faces.ALLOWED_MODULES}")
                
                response = {
                    "type": "face_pose_result",
                    "success": True,
                    "faceId": face_id,
                    "poseYaw": pose_yaw,
                    "posePitch": pose_pitch,
                    "poseRoll": pose_roll,
                    "faceQuality": face_quality,
                    "descriptorV2": descriptor_v2
                }
            
    except Exception as e:
        logger.error(f"Pose extraction error: {e}")
        response = {"type": "face_pose_result", "success": False, "error": str(e), "faceId": face_id}
    
    if req_id:
        response['reqId'] = req_id
    
    return response


def extract_age(payload, load_image_cv2_func, req_id=None):
    """
    Extract age and gender from a face crop using InsightFace genderage module.
    
    Args:
        payload: Command payload with filePath, box, faceId, photoId
        load_image_cv2_func: Function to load images (from main.py)
        req_id: Request ID for response tracking
    
    Returns:
        dict: Age extraction result with age, gender, pose, descriptor
    """
    file_path = payload.get('filePath')
    preview_path = payload.get('previewPath')
    box = payload.get('box')  # JSON string: {x, y, width, height}
    face_id = payload.get('faceId')
    photo_id = payload.get('photoId')
    
    logger.info(f"Extracting age for face {face_id}: file={file_path}, box={box}")
    
    try:
        # Parse box if string
        if isinstance(box, str):
            box = json.loads(box)
        
        # IMPORTANT: Use original file path, NOT preview - box coords are from original scan
        img = load_image_cv2_func(file_path)
        if img is None:
            logger.warning(f"Failed to load image: {file_path}")
            response = {"type": "extract_age_result", "success": True, "faceId": face_id, "age": None, "gender": None, "failureReason": "image_load_failed", "reqId": req_id}
        else:
            logger.debug(f"Image loaded: {img.shape[1]}x{img.shape[0]}")
            
            # Expand box for better detection
            x = int(box.get('x', 0))
            y = int(box.get('y', 0))
            w = int(box.get('width', 100))
            h = int(box.get('height', 100))
            
            logger.debug(f"Face {face_id} box: x={x}, y={y}, w={w}, h={h}")
            
            # Add 100% padding for context (same as pose extraction)
            pad_x = int(w * 1.0)
            pad_y = int(h * 1.0)
            x1 = max(0, x - pad_x)
            y1 = max(0, y - pad_y)
            x2 = min(img.shape[1], x + w + pad_x)
            y2 = min(img.shape[0], y + h + pad_y)
            
            face_crop = img[y1:y2, x1:x2]
            
            logger.debug(f"Face crop size: {face_crop.shape[1]}x{face_crop.shape[0]}")
            
            if face_crop.size == 0 or face_crop.shape[0] < 10 or face_crop.shape[1] < 10:
                logger.warning(f"Face crop too small/empty for face {face_id}")
                response = {"type": "extract_age_result", "success": True, "faceId": face_id, "age": None, "gender": None, "failureReason": "crop_too_small", "reqId": req_id}
            else:
                # Use very low detection threshold for crops - face is already known to exist
                # Re-init with low threshold to maximize re-detection on crops
                faces.init_insightface(det_thresh=0.2)
                
                # Run detection on crop
                f_results = faces.app.get(face_crop)
                logger.debug(f"Face {face_id}: detected {len(f_results)} faces in crop")
                
                age, gender, failure_reason = None, None, None
                
                if len(f_results) > 0:
                    # Take the largest detected face
                    best_face = max(f_results, key=lambda f: (f.bbox[2]-f.bbox[0]) * (f.bbox[3]-f.bbox[1]))
                    
                    # Extract age and gender from genderage module
                    if hasattr(best_face, 'age') and best_face.age is not None:
                        age = int(best_face.age)
                    else:
                        failure_reason = "no_age_attribute"
                    
                    if hasattr(best_face, 'sex') and best_face.sex is not None:
                        gender = "M" if best_face.sex == "M" else ("F" if best_face.sex == "F" else None)
                    
                    # Log success at INFO level so it's visible
                    if age is not None:
                        logger.info(f"[OK] Face {face_id}: age={age}, gender={gender}")  # codeql[py/clear-text-logging-sensitive-data]
                    else:
                        logger.warning(f"Face {face_id}: detected but no age attribute")
                else:
                    failure_reason = "no_face_detected"
                    logger.warning(f"No face detected in crop for face {face_id}")
                
                # Extract pose data if available (Phase 2.1: Pose Backfill)
                pose_yaw, pose_pitch, pose_roll = None, None, None
                if len(f_results) > 0 and hasattr(best_face, 'pose') and best_face.pose is not None:
                    try:
                        pose = best_face.pose
                        pose_pitch = float(pose[0]) if len(pose) > 0 else None
                        pose_yaw = float(pose[1]) if len(pose) > 1 else None
                        pose_roll = float(pose[2]) if len(pose) > 2 else None
                    except (TypeError, IndexError):
                        pass
                
                # Extract descriptor_v2 (Phase 2.3: AdaFace/Quality-Aware Embeddings)
                # This re-embeds the face from the padded crop for potentially better quality
                descriptor_v2 = None
                if len(f_results) > 0 and hasattr(best_face, 'embedding') and best_face.embedding is not None:
                    try:
                        embedding = best_face.embedding.tolist()
                        # Normalize the embedding
                        norm = sum(e**2 for e in embedding) ** 0.5
                        if norm > 0:
                            descriptor_v2 = [e / norm for e in embedding]
                    except Exception as emb_err:
                        logger.warning(f"[extract_age] Embedding extraction failed: {emb_err}")
                
                response = {
                    "type": "extract_age_result",
                    "success": True,
                    "faceId": face_id,
                    "age": age,
                    "gender": gender,
                    "poseYaw": pose_yaw,
                    "posePitch": pose_pitch,
                    "poseRoll": pose_roll,
                    "descriptorV2": descriptor_v2,
                    "failureReason": failure_reason,
                    "reqId": req_id
                }
            
    except Exception as e:
        logger.error(f"Age extraction error for face {face_id}: {e}")
        response = {"type": "extract_age_result", "success": True, "faceId": face_id, "age": None, "gender": None, "failureReason": f"exception:{str(e)[:50]}", "reqId": req_id}
    
    return response
