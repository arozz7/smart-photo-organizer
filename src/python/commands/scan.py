"""
Face scanning and image analysis commands.

This module contains the analyze_image command and related face detection logic.
Extracted from main.py to comply with file size limits.
"""

import time
import logging
import cv2
import numpy as np

# Import shared modules
import facelib.faces as faces
import facelib.vlm as vlm
import facelib.image_ops as image_ops
import facelib.adaface as adaface  # [Phase 59] AdaFace for low-quality faces

logger = logging.getLogger('ai_engine.scan')

# Global config (will be passed from main)
CONFIG = {}

def set_config(config):
    """Set global configuration from main.py"""
    global CONFIG
    CONFIG = config

def get_adaptive_embedding(face_obj, face_crop, blur_score):
    """
    Select embedding model based on face quality.
    
    [Phase 59] Adaptive Embedding Selection:
    - Low quality (blur < 50): Use AdaFace (better for blurry/profile faces)
    - High quality (blur >= 50): Use ArcFace (InsightFace default)
    
    Args:
        face_obj: InsightFace face object (has .embedding from ArcFace)
        face_crop: Cropped face image (BGR, uint8) for AdaFace
        blur_score: Face blur score (0-100, higher = sharper)
    
    Returns:
        list: 512-dim embedding vector
    """
    from config import ADAFACE_ENABLED, ADAFACE_BLUR_THRESHOLD
    
    # Check if AdaFace is enabled and available
    if ADAFACE_ENABLED and adaface.is_available() and blur_score < ADAFACE_BLUR_THRESHOLD:
        # Use AdaFace for low-quality faces
        logger.debug(f"[AdaFace] Using AdaFace for low-quality face (blur={blur_score:.1f})")
        embedding = adaface.get_embedding(face_crop)
        
        if embedding is not None:
            return embedding.tolist()
        else:
            # Fallback to ArcFace if AdaFace fails
            logger.warning("[AdaFace] Extraction failed, falling back to ArcFace")
            return face_obj.embedding.tolist() if hasattr(face_obj, 'embedding') else []
    else:
        # Use ArcFace (InsightFace default) for high-quality faces
        return face_obj.embedding.tolist() if hasattr(face_obj, 'embedding') else []

def analyze_image(payload, load_image_cv2_func, req_id=None):
    """
    Analyze an image for faces using InsightFace and optional VLM tagging.
    
    Args:
        payload: Command payload with photoId, filePath, scanMode, etc.
        load_image_cv2_func: Function to load images (from main.py)
        req_id: Request ID for response tracking
    
    Returns:
        dict: Analysis result with faces, tags, metrics
    """
    t_start = time.time()
    
    photo_id = payload.get('photoId')
    file_path = payload.get('filePath')
    scan_mode = payload.get('scanMode', 'FAST')
    enable_vlm = payload.get('enableVLM', False)
    orientation = payload.get('orientation', 1)  # Default 1 (Normal)
    config = payload.get('config', {})
    
    # [Phase 55] Advanced Settings
    det_thresh_standard = float(config.get('detThreshStandard', faces.DET_THRESH))
    det_thresh_macro = float(config.get('detThreshMacro', 0.25))
    nms_iou_thresh = float(config.get('nmsIouThresh', 0.3))
    enable_macro_low_res = config.get('enableMacroLowRes', True)
    enable_tta = config.get('enableTTA', True)
    
    metrics = {'load': 0, 'scan': 0, 'tag': 0, 'total': 0}
    
    logger.debug(f"Analyzing {photo_id} (Mode: {scan_mode}, VLM: {enable_vlm}, Ori: {orientation})...")
    logger.info(f"[Config] Mode={scan_mode} | Thresh={det_thresh_standard}(Std)/{det_thresh_macro}(Mac) | NMS={nms_iou_thresh} | TTA={enable_tta} | LowRes={enable_macro_low_res}")
    
    # 1. Image Loading
    t_load_start = time.time()
    img = load_image_cv2_func(file_path)

    if img is None:
        response = {"type": "analysis_result", "photoId": photo_id, "error": f"Image Load Failed", "scanMode": scan_mode}
        if req_id: response['reqId'] = req_id
        return response 
    
    # 2. Conditional Orientation Correction
    # To avoid double-rotation (if PIL worked or RawPy flipped it), check dimensions.
    h, w = img.shape[:2]
    is_landscape_dims = w > h
    is_portrait_dims = h > w
    
    # Orientation 6 (90 CW) or 8 (270 CW) implies Portrait final result
    expects_portrait = (orientation == 6 or orientation == 8)
    
    if expects_portrait and is_landscape_dims:
        logger.info(f"Orientation {orientation} (Portrait) but Image is {w}x{h} (Landscape). Applying Rotation.")
        if orientation == 6:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        elif orientation == 8:
            img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    elif orientation == 3:  # 180 Rotation (Landscape -> Landscape)
         # Harder to detect by dims alone, but 180 usually means upsidedown. 
         # We assume if explicit 180 passed, we should rotate 180 unless we have strong reason not to.
         # But for safety, let's trust the flag if it's 180.
         img = cv2.rotate(img, cv2.ROTATE_180)
         logger.info("Applied Manual Rotation: 180")
         
    # Re-calc dimensions
    h, w = img.shape[:2]

    metrics['load'] = (time.time() - t_load_start) * 1000
    
    # 2. Face Scanning (Modular)
    t_scan_start = time.time()
    scan_results = []
    global_blur = 0.0
    
    try:
        if not faces.app: faces.init_insightface()
        
        # Calculate Global Blur (VoL) for metadata
        try:
             h, w = img.shape[:2]
             if max(h, w) > 1024:
                 s = 1024 / max(h, w)
                 small = cv2.resize(img, (int(w*s), int(h*s)))
             else:
                 small = img
             global_blur = image_ops.estimate_blur(small)
        except: pass

        # --- DETECTOR CALL ---
        import facelib.detector as detector_module
        # [Fix] Pass the merged config (payload) instead of global CONFIG
        # This ensures request-specific thresholds (detThreshStandard) are respected.
        detector = detector_module.FaceDetector(config)
        scan_results = detector.detect(img, scan_mode=scan_mode)
        
        logger.info(f"[Face] Detector returned {len(scan_results)} raw candidates.")
            
    except Exception as e:
        logger.error(f"Analysis (Scan) Error: {e}")
        import traceback
        traceback.print_exc()

    # [Phase 57] Filter out multi-face boxes by aspect ratio
    # Faces are roughly square. If a box is too wide (>1.5:1) or too tall (<1:1.5), it likely contains multiple faces.
    # Threshold tuned based on observed data: normal faces 1.0-1.4, multi-face boxes >1.5
    filtered_results = []
    for f in scan_results:
        box = f['box']
        
        # [Sanity Check] Reject invalid boxes (negative dimensions)
        if box['width'] <= 0 or box['height'] <= 0:
            logger.warning(f"[Filter] Rejected invalid box dimensions: {box}")
            continue
            
        aspect_ratio = box['width'] / box['height']
        face_quality = f.get('faceQuality', 0)
        
        # [Phase 74] High Quality Exception: Skip aspect ratio filter for high-quality faces
        # These have already been validated by NMS and should be preserved (e.g., Mother+Baby)
        if face_quality > 0.70:
            logger.debug(f"[Filter] Skipping aspect ratio check for high-quality face (score={f.get('score',0):.2f}, quality={face_quality:.2f}, AR={aspect_ratio:.2f}, box={box})")
            filtered_results.append(f)
        elif aspect_ratio > 2.2 or aspect_ratio < 0.45:  # Loosened from 1.5/0.67 to improve recall
            logger.debug(f"[Filter] Rejected multi-face box: aspect ratio {aspect_ratio:.2f} (box: {box})")
        else:
            logger.debug(f"[Filter] Accepted box: aspect ratio {aspect_ratio:.2f} (box: {box})")
            filtered_results.append(f)
    
    if len(filtered_results) < len(scan_results):
        logger.debug(f"[Filter] Aspect ratio filter removed {len(scan_results) - len(filtered_results)} multi-face boxes")
        scan_results = filtered_results
    
    # NMS (De-Duplicate)
    # --- FINAL NMS MERGE (Modular) ---
    logger.info(f"[NMS] Resolving conflicts for {len(scan_results)} candidates (Loop 2)...")
    import facelib.nms as nms
    scan_results = nms.resolve_conflicts(scan_results, config)
    
    unique_faces = scan_results # Alias for legacy logging if needed
    
    metrics['scan'] = (time.time() - t_scan_start) * 1000
    logger.info(f"[Face] Analysis complete. Total unique faces: {len(scan_results)}")
    
    # 3. VLM Tagging
    t_tag_start = time.time()
    tags_result = []
    description_result = ""
    
    if enable_vlm:
        try:
            if not vlm.vlm_model: vlm.init_vlm()
            if vlm.vlm_model:
                 description_result, tags_result = vlm.generate_captions(file_path)
        except Exception as e:
            logger.error(f"Analysis (VLM) Error: {e}")
    
    metrics['tag'] = (time.time() - t_tag_start) * 1000
    metrics['total'] = (time.time() - t_start) * 1000

    # [Phase 107] Compute perceptual hash while image is already loaded
    phash_value = None
    try:
        from duplicate_detection import compute_phash
        phash_value = compute_phash(file_path)
    except Exception as e:
        logger.warning(f"[scan] pHash computation failed: {e}")

    response = {
        "type": "analysis_result",
        "photoId": photo_id,
        "faces": scan_results,
        "tags": tags_result,
        "description": description_result,
        "metrics": metrics,
        "scanMode": scan_mode,
        "globalBlurScore": float(global_blur),
        "phash": phash_value,
        "width": img.shape[1],
        "height": img.shape[0]
    }
    
    if req_id:
        response['reqId'] = req_id
    
    return response


def detect_faces_in_region(payload, load_image_cv2_func, req_id=None):
    """
    [Phase 58] Re-run face detection on a cropped region to count/split faces.
    Used when aspect ratio filter flags a potential multi-face box.
    
    Args:
        payload: {
            filePath: str,
            box: {x, y, width, height},
            orientation: int (optional, default 1),
            detThreshold: float (optional, default 0.5)
        }
        load_image_cv2_func: Function to load images (from main.py)
        req_id: Request ID for response tracking
    
    Returns:
        {
            type: "region_faces_result",
            faceCount: int,
            faces: [{box, score, embedding}, ...],
            reqId: str
        }
    """
    file_path = payload.get('filePath')
    box = payload.get('box')
    orientation = payload.get('orientation', 1)
    det_threshold = payload.get('detThreshold', 0.5)
    det_size = payload.get('detSize') # Optional tuple (w, h)
    
    logger.info(f"[Phase 58] Detecting faces in region: {box} (threshold: {det_threshold}, size: {det_size})")
    
    try:
        # Load and orient image
        img = load_image_cv2_func(file_path)
        
        if img is None:
            return {
                'type': 'region_faces_result',
                'error': 'Image load failed',
                'faceCount': 0,
                'faces': [],
                'reqId': req_id
            }
        
        # Apply orientation if needed (same logic as analyze_image)
        h, w = img.shape[:2]
        is_landscape_dims = w > h
        expects_portrait = (orientation == 6 or orientation == 8)
        
        if expects_portrait and is_landscape_dims:
            if orientation == 6:
                img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
            elif orientation == 8:
                img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        elif orientation == 3:
            img = cv2.rotate(img, cv2.ROTATE_180)
        
        # Crop to region (with 10% padding for context)
        x, y, w_box, h_box = box['x'], box['y'], box['width'], box['height']
        pad = int(min(w_box, h_box) * 0.1)
        
        img_h, img_w = img.shape[:2]
        y1 = max(0, y - pad)
        y2 = min(img_h, y + h_box + pad)
        x1 = max(0, x - pad)
        x2 = min(img_w, x + w_box + pad)
        
        crop = img[y1:y2, x1:x2]
        
        # Run detection on crop
        init_kwargs = {'det_thresh': det_threshold}
        if det_size:
            init_kwargs['det_size'] = tuple(det_size)
            
        faces.init_insightface(**init_kwargs)
        detected = faces.app.get(crop)
        
        logger.info(f"[Phase 58] Found {len(detected)} faces in region")
        
        # Translate coordinates back to original image space
        faces_in_region = []
        for face in detected:
            bbox = face.bbox
            
            # Translate from crop coordinates to original image coordinates
            orig_x1 = int(bbox[0] + x1)
            orig_y1 = int(bbox[1] + y1)
            orig_x2 = int(bbox[2] + x1)
            orig_y2 = int(bbox[3] + y1)
            
            faces_in_region.append({
                'box': {
                    'x': orig_x1,
                    'y': orig_y1,
                    'width': orig_x2 - orig_x1,
                    'height': orig_y2 - orig_y1
                },
                'score': float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                'embedding': face.embedding.tolist() if hasattr(face, 'embedding') else None
            })
        
        return {
            'type': 'region_faces_result',
            'faceCount': len(faces_in_region),
            'faces': faces_in_region,
            'reqId': req_id
        }
        
    except Exception as e:
        logger.error(f"[Phase 58] detect_faces_in_region error: {e}")
        return {
            'type': 'region_faces_result',
            'error': str(e),
            'faceCount': 0,
            'faces': [],
            'reqId': req_id
        }

