import logging
import time
import cv2
import numpy as np

import facelib.faces as faces
import facelib.image_ops as image_ops
import facelib.adaface as adaface

logger = logging.getLogger('ai_engine.detector')

class FaceDetector:
    def __init__(self, config=None):
        self.config = config or {}
        
        # Default Configs
        from config import AI_CONFIG
        self.det_thresh_standard = float(self.config.get('detThreshStandard', faces.DET_THRESH))
        self.det_thresh_macro = float(self.config.get('detThreshMacro', 0.25))
        self.nms_iou_thresh = float(self.config.get('nmsIouThresh', 0.3))
        self.enable_macro_low_res = self.config.get('enableMacroLowRes', True)
        
        # [Phase 67] Centralized TTA Control
        # Prefer AI_CONFIG, fallback to passed config, default to True
        self.enable_tta = AI_CONFIG.get('face_detection', {}).get('enable_tta', self.config.get('enableTTA', True))

    def detect(self, img, scan_mode='FAST'):
        """
        Main entry point for face detection.
        Orchestrates Multi-Scale Scan + TTA.
        """
        if img is None:
            return []

        # 1. Multi-Scale Scan
        raw_detections = self._scan_multi_scale(img, scan_mode)
        
        # 2. TTA (Rotation) - ONLY for MACRO mode by default or if forced
        if scan_mode == 'MACRO' and self.enable_tta:
            raw_detections = self._scan_tta(img, raw_detections, scan_mode)

        # 3. Format Results (Standardize Output)
        formatted_results = self._format_results(img, raw_detections, scan_mode)
        
        return formatted_results

    def _scan_multi_scale(self, img, scan_mode):
        """
        Deep Ensemble Scan Logic (Standard / Macro / Balanced)
        """
        # Param Selection
        target_size = (1280, 1280)
        det_thresh = self.det_thresh_standard
        
        if scan_mode == 'BALANCED':
            target_size = (640, 640)
            det_thresh = 0.5
        elif scan_mode == 'MACRO':
            target_size = (1280, 1280) 
            det_thresh = self.det_thresh_macro 

        # Define scan passes
        scan_passes = [target_size]
        if scan_mode == 'MACRO':
            if target_size[0] > 640: scan_passes.append((640, 640))
            if target_size[0] > 320: scan_passes.append((320, 320))
            if self.enable_macro_low_res:
                scan_passes.append((160, 160))
        
        pass_idx = 0
        all_detections = []  # List of (face_obj, scan_scale)

        while pass_idx < len(scan_passes):
            current_size = scan_passes[pass_idx]
            pass_idx += 1
            
            # Init Model
            faces.init_insightface(providers=faces.CURRENT_PROVIDERS, 
                                 allowed_modules=faces.ALLOWED_MODULES, 
                                 det_size=current_size, 
                                 det_thresh=det_thresh)
            
            # Inference
            f_results = faces.app.get(img)
            logger.info(f"[Detector] Pass {current_size}: Found {len(f_results)} faces.")
            
            # Collect results
            for f in f_results:
                all_detections.append((f, current_size[0]))

            # [Phase 53] Smart Portrait Trigger (Standard Mode Only)
            if scan_mode != 'MACRO' and pass_idx == 1:
                 should_fallback = False
                 # 1. Zero faces
                 if len(f_results) == 0: 
                    should_fallback = True
                    logger.info("[Detector] Standard scan found 0. Triggering Fallback scales...")

                 # 2. Large Face (>15% img height)
                 elif len(f_results) > 0:
                    max_h = 0
                    for f in f_results:
                        box_h = f.bbox[3] - f.bbox[1]
                        if box_h > max_h: max_h = box_h
                    
                    img_h = img.shape[0] if len(img.shape) > 0 else 1000
                    if max_h > (img_h * 0.15):
                         should_fallback = True
                         logger.info(f"[Detector] Large face detected. Triggering Portrait Ensemble...")

                 if should_fallback:
                     for size in [(640, 640), (320, 320)]:
                         if size not in scan_passes and current_size[0] > size[0]:
                             scan_passes.append(size)

        # Merge Multi-Scale Results (Simple IoU NMS)
        return self._merge_multi_scale(all_detections)

    def _merge_multi_scale(self, all_detections):
        """
        Merges results from different scales (e.g. 1280px vs 640px).
        Uses simple IoU because these are the same box from different runs.
        """
        all_detections.sort(key=lambda x: x[0].det_score if hasattr(x[0], 'det_score') else 0, reverse=True)
        
        final_faces = []
        while len(all_detections) > 0:
            best_face_set = all_detections[0]
            best_face = best_face_set[0]
            final_faces.append(best_face_set)
            
            remaining = []
            b1 = best_face.bbox
            area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
            
            for i in range(1, len(all_detections)):
                other_face = all_detections[i][0]
                b2 = other_face.bbox
                
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
                
                if iou < self.nms_iou_thresh:
                    remaining.append(all_detections[i])
            
            all_detections = remaining
        return final_faces

    def _scan_tta(self, img, base_results, scan_mode):
        """
        Test Time Augmentation (Rotations)
        """
        logger.info("[Detector] TTA Initiated...")
        
        # TTA Param Setup
        det_thresh = self.det_thresh_standard if scan_mode != 'MACRO' else self.det_thresh_macro
        TTA_THRESHOLD_BOOST = 0.10
        if scan_mode == 'MACRO':
            safe_thresh = det_thresh # No boost for Macro
        else:
            safe_thresh = max(det_thresh + TTA_THRESHOLD_BOOST, 0.45) if det_thresh < 0.5 else det_thresh 

        tta_scales = [(1280, 1280)]
        if scan_mode == 'MACRO':
            tta_scales.append((640, 640))

        # We append TTA results to base results
        # Format for TTA items: (face_object, scale, rotation_angle)
        # Base results only had (face, scale), so we map them to (face, scale, 0)
        combined_results = [(f, s, 0) for f, s in base_results]

        for rot_angle in [90, 180, 270]:
            rotated_img = None
            if rot_angle == 90: rotated_img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
            elif rot_angle == 180: rotated_img = cv2.rotate(img, cv2.ROTATE_180)
            elif rot_angle == 270: rotated_img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
            else: continue

            for current_tta_size in tta_scales:
                try:
                    faces.init_insightface(providers=faces.CURRENT_PROVIDERS, 
                                         allowed_modules=faces.ALLOWED_MODULES, 
                                         det_size=current_tta_size, 
                                         det_thresh=safe_thresh)
                    r_faces = faces.app.get(rotated_img)

                    if len(r_faces) > 0:
                        orig_h, orig_w = img.shape[:2]
                        logger.info(f"[Detector] TTA Rot {rot_angle}: Found {len(r_faces)} faces")
                        
                        for face in r_faces:
                            # Re-check score
                            if hasattr(face, 'det_score') and face.det_score < safe_thresh:
                                continue

                            # De-Rotate BBox logic
                            bbox = face.bbox.astype(int).tolist()
                            rx1, ry1, rx2, ry2 = bbox
                            
                            # Rotate points back to original space
                            if rot_angle == 90:
                                pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                                orig_pts = [(py, orig_h - px) for px, py in pts]
                            elif rot_angle == 180:
                                pts = [(rx1, ry1), (rx2, ry2)]
                                orig_pts = [(orig_w - px, orig_h - py) for px, py in pts]
                            elif rot_angle == 270:
                                pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                                orig_pts = [(orig_w - py, px) for px, py in pts]
                            
                            oxs = [p[0] for p in orig_pts]
                            oys = [p[1] for p in orig_pts]
                            nx1, nx2 = min(oxs), max(oxs)
                            ny1, ny2 = min(oys), max(oys)
                            
                            # Clamp
                            nx1, nx2 = max(0, nx1), min(orig_w, nx2)
                            ny1, ny2 = max(0, ny1), min(orig_h, ny2)
                            
                            # Hack: Update the face.bbox to the derotated one so downstream logic works
                            face.bbox = np.array([nx1, ny1, nx2, ny2])
                            
                            combined_results.append((face, current_tta_size[0], rot_angle))

                except Exception as e:
                    logger.error(f"[Detector] TTA Error: {e}")
        
        return combined_results

    def _format_results(self, img, detections, scan_mode):
        """
        Convert InsightFace objects to Standard Dictionary Format.
        Calculates Quality, Embeddings (AdaFace), Age/Gender.
        Returns cleaned list.
        """
        formatted = []
        
        # Helper for Adaptive Embedding
        def get_adaptive_embedding(face_obj, face_crop, blur_score):
             from config import ADAFACE_ENABLED, ADAFACE_BLUR_THRESHOLD
             if ADAFACE_ENABLED and adaface.is_available() and blur_score < ADAFACE_BLUR_THRESHOLD:
                 try:
                     return adaface.get_embedding(face_crop).tolist()
                 except: 
                     return face_obj.embedding.tolist() if hasattr(face_obj, 'embedding') else []
             return face_obj.embedding.tolist() if hasattr(face_obj, 'embedding') else []

        for item in detections:
            # Handle TTA vs Non-TTA tuple size
            if len(item) == 3:
                face, scan_source_size, rot_angle = item
            else:
                face, scan_source_size = item
                rot_angle = 0
            
            # --- EXTRACT METADATA ---
            pose_yaw, pose_pitch, pose_roll = None, None, None
            if hasattr(face, 'pose') and face.pose is not None:
                try:
                    pose = face.pose
                    pose_pitch = float(pose[0]) if len(pose) > 0 else None
                    pose_yaw = float(pose[1]) if len(pose) > 1 else None
                    pose_roll = float(pose[2]) if len(pose) > 2 else None
                except: pass
            
            bbox = face.bbox.astype(int).tolist()
            kps = face.kps if hasattr(face, 'kps') else None
            
            # Crop Strategy
            if pose_yaw is not None and abs(pose_yaw) > 30.0:
                 # Profile: Tight box
                 expanded = image_ops.expand_box(bbox, img.shape[1], img.shape[0], 0.1)
            else:
                 # Frontal: Aligned box
                 expanded = image_ops.get_aligned_bbox(bbox, kps, img.shape[1], img.shape[0])

            # Checks & Metrics
            x1, y1, x2, y2 = bbox
            # Safe crop
            img_h, img_w = img.shape[:2]
            cx1, cy1 = max(0, x1), max(0, y1)
            cx2, cy2 = min(img_w, x2), min(img_h, y2)
            face_crop = img[cy1:cy2, cx1:cx2]
            
            if face_crop.size == 0: continue

            f_blur = image_ops.estimate_blur(face_crop, target_size=112) or 0.0
            f_ten = image_ops.estimate_sharpness_tenengrad(face_crop, target_size=112) or 0.0
            
            # Quality Score
            blur_factor = min(f_blur / 100.0, 1.0)
            pose_factor = 0.5
            if pose_yaw is not None:
                pose_factor = max(0, 1.0 - (abs(pose_yaw) / 90.0))
            det_score = float(face.det_score) if hasattr(face, 'det_score') else 0.5
            face_size = bbox[2] - bbox[0]
            size_factor = min(face_size / 200.0, 1.0)
            
            face_quality = (blur_factor * 0.3 + pose_factor * 0.3 + det_score * 0.2 + size_factor * 0.2)
            
            # [DEBUG] Log every Raw Detection
            logger.info(f"[Detector] Raw Candidate: Score={det_score:.4f}, Width={expanded[2]-expanded[0]}, Quality={face_quality:.4f}")
            
            # Pre-Filter (Blur)
            vol_th = self.config.get('faceBlurThreshold', 20.0)
            ten_th = 40.0
            if scan_mode == 'MACRO':
                vol_th = 5.0
                ten_th = 20.0
            
            if f_blur < vol_th and f_ten < ten_th:
                 continue # Reject Blurry

            # Pre-Filter (Size/Confidence)
            fw = expanded[2] - expanded[0]
            
            # 1. Very Small Objects need HIGH confidence (likely noise/texture/shoes)
            # [Phase 65] Strengthened for MACRO mode to reduce noise
            min_size_thresh = 64 if scan_mode == 'MACRO' else 50
            if fw < min_size_thresh and det_score < 0.75:
                logger.info(f"[Filter] Rejecting small low-conf face: Width={fw}, Score={det_score:.3f}")
                continue 
            
            # 2. General Low Confidence Check
            # Use dynamic threshold from centralized config
            from config import AI_CONFIG
            
            # [Phase 66] Standardized Thresholds
            strict_floor = AI_CONFIG['face_detection']['score_threshold_strict'] # e.g. 0.60
            
            min_score = strict_floor
            if scan_mode == 'MACRO':
                min_score = self.det_thresh_macro # Legacy macro override (0.25)
                
            if det_score < min_score:
                # Even if below strict floor, we allow VERY large faces in case of weird occlusions?
                # No, strict floor is strict.
                if fw < 300:
                    logger.info(f"[Filter] Rejecting low-conf face: Score={det_score:.3f} < {min_score}, Width={fw}")
                    continue      
            
            # Descriptor
            descriptor = get_adaptive_embedding(face, face_crop, f_blur)
            
            # Entity Type logic removed - handled in Electron (FaceService)


            formatted.append({
                "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                "descriptor": descriptor,
                "score": det_score,
                "blurScore": float(f_blur),
                "poseYaw": pose_yaw,
                "posePitch": pose_pitch,
                "poseRoll": pose_roll,
                "faceQuality": face_quality,
                "rotation_fix": rot_angle,
                "estimatedAge": int(face.age) if hasattr(face, 'age') and face.age is not None else None,
                "gender": "M" if hasattr(face, 'sex') and face.sex == "M" else ("F" if hasattr(face, 'sex') and face.sex == "F" else None),
                "scan_source": f"{scan_source_size}px",
                "scan_source": f"{scan_source_size}px"
            })
            
        return formatted
