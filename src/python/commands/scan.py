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
        if req_id:
            response['reqId'] = req_id
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
    
    # 2. Face Scanning
    t_scan_start = time.time()
    scan_results = []
    global_blur = 0.0
    
    try:
        if not faces.app: faces.init_insightface()
        
        # Param Selection
        target_size = (1280, 1280)
        # Use configured threshold (0.7) for standard scans to reduce false positives
        det_thresh = det_thresh_standard
        
        if scan_mode == 'BALANCED':
            target_size = (640, 640)
            det_thresh = 0.5  # Slightly lower for balanced/fast
        elif scan_mode == 'MACRO':
            # [Phase 54] Tuning: 
            # Revert to 1280px (1600px caused pareidolia).
            # Thresh 0.25 (Lowered to catch Sleeping Girl).
            # *Safety:* Area-Based NMS will suppress inner-noise (eyes/mouths).
            target_size = (1280, 1280) 
            det_thresh = det_thresh_macro 
            
        # [Phase 52] Deep Ensemble Scan Logic
        # Define scan passes based on mode
        
        scan_passes = [target_size]
        if scan_mode == 'MACRO':
            # Force check all scales: Standard -> Low Res -> Ultra Low Res (Giant Faces)
            if target_size[0] > 640: scan_passes.append((640, 640))
            if target_size[0] > 320: scan_passes.append((320, 320))
            # Add Ultra-Low Res to catch faces that fill the frame
            if enable_macro_low_res:
                scan_passes.append((160, 160))
        
        # Track unique faces across passes (deduplicated by NMS at end)
        pass_idx = 0
        all_detections = []  # List of (face_obj, scan_scale)

        while pass_idx < len(scan_passes):
            current_size = scan_passes[pass_idx]
            pass_idx += 1
            
            # Check redundancy (simple check)
            
            # Init
            faces.init_insightface(providers=faces.CURRENT_PROVIDERS, allowed_modules=faces.ALLOWED_MODULES, det_size=current_size, det_thresh=det_thresh)
            
            # Inference
            f_results = faces.app.get(img)
            logger.info(f"[Face] Scan pass {current_size}: Found {len(f_results)} faces.")
            
            # Collect results
            for f in f_results:
                all_detections.append((f, current_size[0]))

            # [Phase 53] Smart Portrait Trigger (Standard Mode Only)
            # If 0 faces found -> Fallback (existing)
            # If "Large Face" found (>15% img height) -> Fallback (find profile/hard siblings)
            if scan_mode != 'MACRO' and pass_idx == 1:
                 should_fallback = False
                 
                 # 1. Zero faces (Original Phase 51 logic)
                 if len(f_results) == 0: 
                    should_fallback = True
                    logger.info("[Face] Standard scan found 0. Triggering Fallback scales...")

                 # 2. Large Face (Phase 53: Portrait Context)
                 elif len(f_results) > 0:
                    max_h = 0
                    for f in f_results:
                        # bbox is [x1, y1, x2, y2]
                        box_h = f.bbox[3] - f.bbox[1]
                        if box_h > max_h: max_h = box_h
                    
                    img_h = img.shape[0] if len(img.shape) > 0 else 1000
                    if max_h > (img_h * 0.15):  # >15% of image height
                         should_fallback = True
                         logger.info(f"[Face] Large face detected ({int(max_h)}px > {int(img_h*0.15)}px). Triggering Portrait Ensemble...")

                 if should_fallback:
                     for size in [(640, 640), (320, 320)]:
                         if size not in scan_passes and current_size[0] > size[0]:
                             scan_passes.append(size)

            # --- Global Quality (VoL) - Recalc only on first pass or just once ---
            if pass_idx == 1:
                try:
                     h, w = img.shape[:2]
                     if max(h, w) > 1024:
                         s = 1024 / max(h, w)
                         small = cv2.resize(img, (int(w*s), int(h*s)))
                     else:
                         small = img
                     global_blur = image_ops.estimate_blur(small)
                except: pass
        
        # --- NMS ACROSS PASSES ---
        # Sort by detection score (high to low)
        all_detections.sort(key=lambda x: x[0].det_score if hasattr(x[0], 'det_score') else 0, reverse=True)
        
        final_faces = []
        while len(all_detections) > 0:
            best_face_set = all_detections[0]
            best_face = best_face_set[0]
            final_faces.append(best_face_set)
            
            # Check IoU with rest
            remaining = []
            b1 = best_face.bbox
            area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
            
            for i in range(1, len(all_detections)):
                other_face = all_detections[i][0]
                b2 = other_face.bbox
                
                # Intersect
                xx1 = max(b1[0], b2[0])
                yy1 = max(b1[1], b2[1])
                xx2 = min(b1[2], b2[2])
                yy2 = min(b1[3], b2[3])
                
                w = max(0, xx2 - xx1)
                h = max(0, yy2 - yy1)
                inter = w * h
                
                area2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
                union = area1 + area2 - inter
                
                iou = inter / union if union > 0 else 0
                
                # If IoU < 0.3, keep it (not a duplicate)
                # Note: faces.NMS_THRESH is for InsightFace internal NMS (same scale).
                # Here we are merging multi-scale. A strict threshold is good to avoid duplicates.
                if iou < nms_iou_thresh:
                    remaining.append(all_detections[i])
            
            all_detections = remaining

        # Process Unique Faces
        for item in final_faces:
            face = item[0]
            scan_source_size = item[1]
            
            # [Phase 54] Hybrid Bounding Box Logic
            # Extract Pose FIRST to determine crop strategy
            pose_yaw, pose_pitch, pose_roll = None, None, None
            if hasattr(face, 'pose') and face.pose is not None:
                try:
                    pose = face.pose
                    pose_pitch = float(pose[0]) if len(pose) > 0 else None
                    pose_yaw = float(pose[1]) if len(pose) > 1 else None
                    pose_roll = float(pose[2]) if len(pose) > 2 else None
                except (TypeError, IndexError): pass
            
            bbox = face.bbox.astype(int).tolist()
            kps = face.kps if hasattr(face, 'kps') else None
            
            # Check for Profile View (Yaw > 30 degrees)
            # Profile alignment is unstable (stretches box). Use Tight Raw Box for profiles.
            is_profile = False
            if pose_yaw is not None and abs(pose_yaw) > 30.0:
                is_profile = True
                # Use raw box with very slight padding (10%)
                expanded = image_ops.expand_box(bbox, img.shape[1], img.shape[0], 0.1)
            else: 
             # Frontal: Use Perfect Alignment
             expanded = image_ops.get_aligned_bbox(bbox, kps, img.shape[1], img.shape[0])
            
            # Check blur
            x1, y1, x2, y2 = bbox
            face_crop = img[max(0,y1):min(img.shape[0],y2), max(0,x1):min(img.shape[1],x2)]
            f_blur = image_ops.estimate_blur(face_crop, target_size=112)
            f_ten = image_ops.estimate_sharpness_tenengrad(face_crop, target_size=112)
            
            # ... (Pose extraction was here, now moved up) ...
            
            # Calculate Face Quality Score (Phase 5)
            face_quality = None
            if f_blur is not None:
                blur_factor = min(f_blur / 100.0, 1.0)
                pose_factor = 0.5  # Default if no pose
                if pose_yaw is not None:
                    # 0° = 1.0 (frontal), 90° = 0.0 (profile)
                    pose_factor = max(0, 1.0 - (abs(pose_yaw) / 90.0))
                det_score = float(face.det_score) if hasattr(face, 'det_score') else 0.5
                face_size = bbox[2] - bbox[0]  # width
                size_factor = min(face_size / 200.0, 1.0)
                
                # Weighted average
                face_quality = (blur_factor * 0.3 + pose_factor * 0.3 + det_score * 0.2 + size_factor * 0.2)
            
            # Thresholds
            vol_th = CONFIG.get('faceBlurThreshold', 20.0)
            
            # [Phase 53] Relaxed Sharpness for Standard Mode (Recover soft portraits)
            # Tenengrad 100 is too high for professional soft-focus portraits. Lowering to 40.
            ten_th = 40.0 
            
            if scan_mode == 'MACRO':
                vol_th = 5.0
                ten_th = 20.0
                
            if (f_blur < vol_th) and (f_ten < ten_th):
                logger.info(f"[Filter] Rejecting blurry face: Blur={f_blur:.1f}, Sharpness={f_ten:.1f}")
                continue  # Skip blurry

            # [Phase 53] False Positive Filtering (Shoe/Building/Wall detector)
            # Heuristic: Small faces needs high confidence. Large faces can be lower.
            # Face Width in pixels (approx)
            fw = expanded[2] - expanded[0]
            det_score = float(face.det_score) if hasattr(face, 'det_score') else 0.0
            
            # 1. Very Small Objects (<50px) need HIGH confidence (likely noise/texture/shoes)
            # Relaxed from 80px back to 50px to fix missed detections
            if fw < 50 and det_score < 0.75:
                    logger.info(f"[Filter] Rejecting small low-conf face: Width={fw}, Score={det_score:.3f}")
                    continue 
            
            # 2. General Low Confidence Check
            # Relax for MACRO mode to catch artistic faces
            min_score = 0.50
            if scan_mode == 'MACRO': min_score = 0.25
            
            if det_score < min_score:
                if fw < 300:
                    logger.info(f"[Filter] Rejecting low-conf face: Score={det_score:.3f}, Width={fw}")
                    continue
            
            # [Phase 56] Entity Type for VLM Verification
            from config import VERIFICATION_THRESHOLD, SUSPECT_ENTITY_TYPE
            entity_type = SUSPECT_ENTITY_TYPE if det_score < VERIFICATION_THRESHOLD else 'human'
            
            # [Phase 59] Adaptive Embedding Selection
            # Use AdaFace for low-quality faces (blur < 50), ArcFace for high-quality
            descriptor = get_adaptive_embedding(face, face_crop, f_blur)
            
            scan_results.append({
                "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                "descriptor": descriptor,
                "score": float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                "blurScore": float(f_blur),
                "poseYaw": pose_yaw,
                "posePitch": pose_pitch,
                "poseRoll": pose_roll,
                "faceQuality": face_quality,
                # Age-Based ERA Categorization: Extract age and gender from genderage module
                "estimatedAge": int(face.age) if hasattr(face, 'age') and face.age is not None else None,
                "gender": "M" if hasattr(face, 'sex') and face.sex == "M" else ("F" if hasattr(face, 'sex') and face.sex == "F" else None),
                "scan_source": f"{scan_source_size}px",  # Debug info
                "entityType": entity_type  # Phase 56: Suspect faces for VLM verification
            })

        
        logger.info(f"[Face] Initial scan found {len(scan_results)} faces (cumulative).")
            
    except Exception as e:
        logger.error(f"Analysis (Scan) Error: {e}")

    # Test Time Augmentation (TTA)
    if scan_mode == 'MACRO' and enable_tta:
        logger.info("[TTA] MACRO mode: Initiating Rotation Augmentation (TTA)...")
        
        # [Fix] Reduce false positives in TTA (e.g. knees/elbows in rotated views).
        # Rotated detections must have higher confidence to be accepted.
        TTA_THRESHOLD_BOOST = 0.10
        # Ensure at least 0.45 even if user set 0.25
        safe_thresh = max(det_thresh + TTA_THRESHOLD_BOOST, 0.45) if det_thresh < 0.5 else det_thresh 

        for rot_angle in [90, 180, 270]:
            try:
                logger.info(f"[TTA] Trying rotation {rot_angle}... (Safe Thresh: {safe_thresh:.2f})")
                rotated_img = None
                if rot_angle == 90: rotated_img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
                elif rot_angle == 180: rotated_img = cv2.rotate(img, cv2.ROTATE_180)
                elif rot_angle == 270: rotated_img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
                else: continue

                faces.init_insightface(providers=faces.CURRENT_PROVIDERS, allowed_modules=faces.ALLOWED_MODULES, det_size=target_size, det_thresh=safe_thresh)  # Re-init params with SAFE thresh
                r_faces = faces.app.get(rotated_img)

                if len(r_faces) > 0:
                    orig_h, orig_w = img.shape[:2]
                    logger.info(f"[TTA] Found {len(r_faces)} potential faces in rotation {rot_angle}")
                    
                    for face in r_faces:
                        # Double check score against safe threshold (though init_insightface should handle it)
                        if hasattr(face, 'det_score') and face.det_score < safe_thresh:
                            logger.info(f"[TTA] Rejected face with score {face.det_score:.2f} < {safe_thresh:.2f}")
                            continue

                        bbox = face.bbox.astype(int).tolist()
                        rx1, ry1, rx2, ry2 = bbox
                        nx1, ny1, nx2, ny2 = 0, 0, 0, 0
                        
                        if rot_angle == 90:  # 90 CW
                            pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                            orig_pts = [(py, orig_h - px) for px, py in pts]
                        elif rot_angle == 180:
                            pts = [(rx1, ry1), (rx2, ry2)]
                            orig_pts = [(orig_w - px, orig_h - py) for px, py in pts]
                        elif rot_angle == 270:  # 90 CCW
                            pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                            orig_pts = [(orig_w - py, px) for px, py in pts]
                        
                        oxs = [p[0] for p in orig_pts]
                        oys = [p[1] for p in orig_pts]
                        nx1, nx2 = min(oxs), max(oxs)
                        ny1, ny2 = min(oys), max(oys)
                        nx1, nx2 = max(0, nx1), min(orig_w, nx2)
                        ny1, ny2 = max(0, ny1), min(orig_h, ny2)

                        expanded = image_ops.smart_crop_landmarks([nx1, ny1, nx2, ny2], None, orig_w, orig_h)
                        face_crop = img[int(ny1):int(ny2), int(nx1):int(nx2)]
                        f_blur = image_ops.estimate_blur(face_crop, target_size=112)
                        

                        pose_yaw, pose_pitch, pose_roll = None, None, None
                        if hasattr(face, 'pose') and face.pose is not None:
                            try:
                                pose = face.pose
                                pose_pitch = float(pose[0]) if len(pose) > 0 else None
                                pose_yaw = float(pose[1]) if len(pose) > 1 else None
                                pose_roll = float(pose[2]) if len(pose) > 2 else None
                            except (TypeError, IndexError): pass

                        face_quality = None
                        if f_blur is not None:
                            blur_factor = min(f_blur / 100.0, 1.0)
                            pose_factor = 0.5 
                            if pose_yaw is not None:
                                pose_factor = max(0, 1.0 - (abs(pose_yaw) / 90.0))
                            det_score = float(face.det_score) if hasattr(face, 'det_score') else 0.5
                            face_size = nx2 - nx1 
                            size_factor = min(face_size / 200.0, 1.0)
                            face_quality = (blur_factor * 0.3 + pose_factor * 0.3 + det_score * 0.2 + size_factor * 0.2)

                        # [Phase 59] Adaptive Embedding Selection (TTA faces)
                        descriptor = get_adaptive_embedding(face, face_crop, f_blur)

                        scan_results.append({
                            "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                            "descriptor": descriptor,
                            "score": float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                            "blurScore": float(f_blur),
                            "poseYaw": pose_yaw,
                            "posePitch": pose_pitch,
                            "poseRoll": pose_roll,
                            "faceQuality": face_quality,
                            "rotation_fix": rot_angle,
                            # Age-Based ERA Categorization
                            "estimatedAge": int(face.age) if hasattr(face, 'age') and face.age is not None else None,
                            "gender": "M" if hasattr(face, 'sex') and face.sex == "M" else ("F" if hasattr(face, 'sex') and face.sex == "F" else None)
                        })

            except Exception as e:
                logger.error(f"[TTA] Rotation {rot_angle} failed: {e}")
    
    # [Phase 57] Filter out multi-face boxes by aspect ratio
    # Faces are roughly square. If a box is too wide (>1.5:1) or too tall (<1:1.5), it likely contains multiple faces.
    # Threshold tuned based on observed data: normal faces 1.0-1.4, multi-face boxes >1.5
    filtered_results = []
    for f in scan_results:
        box = f['box']
        aspect_ratio = box['width'] / box['height'] if box['height'] > 0 else 1.0
        if aspect_ratio > 1.5 or aspect_ratio < 0.67:  # Tightened from 1.8/0.55
            logger.info(f"[Filter] Rejected multi-face box: aspect ratio {aspect_ratio:.2f} (box: {box['width']}x{box['height']})")
        else:
            filtered_results.append(f)
    
    if len(filtered_results) < len(scan_results):
        logger.info(f"[Filter] Aspect ratio filter removed {len(scan_results) - len(filtered_results)} multi-face boxes")
        scan_results = filtered_results
    
    # NMS (De-Duplicate)
    # --- FINAL NMS MERGE (Standard + TTA) ---
    if len(scan_results) > 1:
        # Sort by AREA (Size) descending.
        # Rationale: Large faces are "Truer" than small nested faces (e.g. eyes/mouths detected as faces).
        # If we sort by score, a high-confidence "Eye" suppresses the low-conf "Giant Face".
        # Sorting by size ensures the Giant Face eats the Eye.
        scan_results.sort(key=lambda x: x['box']['width'] * x['box']['height'], reverse=True)
        unique_faces = []
        
        for f in scan_results:
            box_a = f['box']
            embedding_a = f.get('descriptor')  # Face embedding
            is_dup = False
            
            for existing in unique_faces:
                box_b = existing['box']
                embedding_b = existing.get('descriptor')
                
                # Intersect
                x1 = max(box_a['x'], box_b['x'])
                y1 = max(box_a['y'], box_b['y'])
                x2 = min(box_a['x'] + box_a['width'], box_b['x'] + box_b['width'])
                y2 = min(box_a['y'] + box_a['height'], box_b['y'] + box_b['height'])
                
                inter_area = max(0, x2 - x1) * max(0, y2 - y1)
                area_a = box_a['width'] * box_a['height']
                area_b = box_b['width'] * box_b['height']
                
                union = area_a + area_b - inter_area
                # iou = inter_area / float(union) if union > 0 else 0
                
                # [Phase 54] Switch to IoMin (Containment)
                # If the smaller box is > 65% contained in the larger box, merge it.
                # This handles "Ghost" detections (scale duplicates) much better than IoU.
                min_area = min(area_a, area_b)
                io_min = inter_area / float(min_area) if min_area > 0 else 0
                
                # [Phase 57] Multi-Face Box Prevention
                if io_min > 0.65:
                    # Additional checks before merging
                    should_merge = True
                    
                    # Check 1: Embedding Distance (if available)
                    # [Phase 57] Only compare embeddings if boxes are from the SAME rotation
                    # Different rotations of same face have distance >1.2, so we skip the check
                    rotation_a = f.get('rotation_fix', 0)
                    rotation_b = existing.get('rotation_fix', 0)
                    
                    if rotation_a == rotation_b and embedding_a is not None and embedding_b is not None and len(embedding_a) > 0 and len(embedding_b) > 0:
                        emb_a = np.array(embedding_a)
                        emb_b = np.array(embedding_b)
                        
                        # Normalize embeddings (InsightFace embeddings should already be normalized, but ensure it)
                        norm_a = np.linalg.norm(emb_a)
                        norm_b = np.linalg.norm(emb_b)
                        if norm_a > 0:
                            emb_a = emb_a / norm_a
                        if norm_b > 0:
                            emb_b = emb_b / norm_b
                        
                        dist = np.linalg.norm(emb_a - emb_b)
                        # [Phase 57] Threshold tuned for rotations:
                        # Same face, same rotation: ~0.0-0.3
                        # Same face, different rotation: ~0.8-1.0
                        # Different faces: >1.3
                        if dist > 1.2:  # Different faces (L2 distance > 1.2 on normalized vectors)
                            should_merge = False
                            logger.info(f"[NMS] Prevented merge: embedding distance {dist:.3f} > 1.2 (different faces)")
                    
                    # Check 2: Aspect Ratio (combined box)
                    if should_merge:
                        combined_x = min(box_a['x'], box_b['x'])
                        combined_y = min(box_a['y'], box_b['y'])
                        combined_x2 = max(box_a['x'] + box_a['width'], box_b['x'] + box_b['width'])
                        combined_y2 = max(box_a['y'] + box_a['height'], box_b['y'] + box_b['height'])
                        combined_width = combined_x2 - combined_x
                        combined_height = combined_y2 - combined_y
                        aspect_ratio = combined_width / combined_height if combined_height > 0 else 1.0
                        
                        # Faces are roughly square (aspect ratio ~1.0)
                        # If combined box is too wide (>2:1) or too tall (<1:2), it's likely 2 faces
                        if aspect_ratio > 2.0 or aspect_ratio < 0.5:
                            should_merge = False
                            logger.info(f"[NMS] Prevented merge: aspect ratio {aspect_ratio:.2f} out of range [0.5, 2.0] (likely 2 faces)")
                    
                    if should_merge:
                        is_dup = True
                        break
            
            if not is_dup: 
                unique_faces.append(f)
        
        logger.info(f"[Face] Post-TTA NMS reduced count from {len(scan_results)} to {len(unique_faces)}.")
        scan_results = unique_faces
    
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
    
    response = {
        "type": "analysis_result",
        "photoId": photo_id,
        "faces": scan_results,
        "tags": tags_result,
        "description": description_result,
        "metrics": metrics,
        "scanMode": scan_mode,
        "globalBlurScore": float(global_blur),
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
    
    logger.info(f"[Phase 58] Detecting faces in region: {box} (threshold: {det_threshold})")
    
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
        faces.init_insightface(det_thresh=det_threshold)
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

