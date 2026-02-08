import numpy as np
import logging

logger = logging.getLogger('ai_engine.nms')

def resolve_conflicts(detections, config):
    """
    Resolve overlapping face detections using a robust consensus strategy.
    
    Strategies:
    1. Sort by Quality (Primary) and Area (Secondary).
    2. Iterate and Merge using IoMin (Containment).
    3. Conflict Logic:
       - High Overlap (>90%): FORCE MERGE (Physics Trumps AI).
       - Medium Overlap (>75%): MERGE BY QUALITY if different embeddings (Trash/Ghost).
       - Standard Overlap (>30%): MERGE if same person (Embedding Dist Check).
       - Variance Veto: Block merge if Age/Gender significantly differ (unless High Overlap).
       
    Args:
        detections (list): List of face dicts.
        config (dict): Configuration dict.
        
    Returns:
        list: Unique face dicts.
    """
    if len(detections) <= 1:
        return detections

    # [Logic Step 1] Sorting
    # We prioritize QUALITY over Area. A small sharp face is better than a large blurry blob.
    # If quality is missing, fallback to area.
    def sort_key(f):
        q = f.get('faceQuality', 0)
        box = f['box']
        area = box['width'] * box['height']
        # Normalized score: Quality (0-1) * 1000 + Area-Log-Factor
        # This ensures Quality is primary, but within same quality, larger is better.
        return (q * 1000000) + area

    detections.sort(key=sort_key, reverse=True)
    
    # [Phase 74] Pre-Pass: Reject "Container" boxes
    # A container box is one that fully contains other high-quality faces.
    # This happens when the detector merges multiple faces into one bounding box.
    # If we have a large box that contains a smaller high-quality face with distinct embedding,
    # the large box is likely a multi-face detection artifact.
    from config import AI_CONFIG
    high_quality_threshold = AI_CONFIG.get('face_detection', {}).get('high_quality_face_threshold', 0.70)
    
    container_ids_to_remove = set()
    for i, large in enumerate(detections):
        box_large = large['box']
        area_large = box_large['width'] * box_large['height']
        q_large = large.get('faceQuality', 0)
        emb_large = large.get('descriptor')
        
        for j, small in enumerate(detections):
            if i == j:
                continue
            box_small = small['box']
            area_small = box_small['width'] * box_small['height']
            q_small = small.get('faceQuality', 0)
            emb_small = small.get('descriptor')
            
            # Check if small is contained in large
            # Calculate IoMin (containment)
            x1 = max(box_large['x'], box_small['x'])
            y1 = max(box_large['y'], box_small['y'])
            x2 = min(box_large['x'] + box_large['width'], box_small['x'] + box_small['width'])
            y2 = min(box_large['y'] + box_large['height'], box_small['y'] + box_small['height'])
            inter_area = max(0, x2 - x1) * max(0, y2 - y1)
            io_min = inter_area / float(area_small) if area_small > 0 else 0
            
            # If small is mostly contained in large (IoMin > 0.9)
            if io_min > 0.9 and area_large > area_small * 1.5:
                # Check embedding distance - are they different people?
                dist = 2.0
                if emb_large and emb_small and len(emb_large) > 0 and len(emb_small) > 0:
                    import numpy as np
                    v_a = np.array(emb_large)
                    v_b = np.array(emb_small)
                    n_a = np.linalg.norm(v_a)
                    n_b = np.linalg.norm(v_b)
                    if n_a > 0: v_a /= n_a
                    if n_b > 0: v_b /= n_b
                    dist = np.linalg.norm(v_a - v_b)
                
                # If different people AND small face is high quality
                if dist > 1.0 and q_small > high_quality_threshold:
                    logger.info(f"[NMS] Container Rejection: Large box ({box_large['width']}x{box_large['height']}) contains smaller high-quality face ({box_small['width']}x{box_small['height']}). Dist={dist:.2f}. Rejecting large box.")
                    container_ids_to_remove.add(i)
                    break  # Don't need to check more - this box is rejected
    
    # Remove container boxes
    if container_ids_to_remove:
        detections = [d for i, d in enumerate(detections) if i not in container_ids_to_remove]
        logger.info(f"[NMS] Removed {len(container_ids_to_remove)} container boxes. Remaining: {len(detections)}")
    
    unique_faces = []
    
    # Thresholds from Config
    # If checking for "Duplicate Person", how strict?
    # [Phase 73 Fix] Lowered from 1.4/1.5 to prevent merging Distinct Ambiguous Faces (e.g. Dist ~1.3)
    threshold_strict = 1.1  # Same Rotation
    threshold_lax = 1.2     # Diff Rotation
    
    for f in detections:
        box_a = f['box']
        embedding_a = f.get('descriptor')
        rotation_a = f.get('rotation_fix', 0)
        
        should_merge = False
        target_existing = None
        
        for existing in unique_faces:
            box_b = existing['box']
            embedding_b = existing.get('descriptor')
            rotation_b = existing.get('rotation_fix', 0)
            
            # Intersection Calcs
            x1 = max(box_a['x'], box_b['x'])
            y1 = max(box_a['y'], box_b['y'])
            x2 = min(box_a['x'] + box_a['width'], box_b['x'] + box_b['width'])
            y2 = min(box_a['y'] + box_a['height'], box_b['y'] + box_b['height'])
            
            inter_area = max(0, x2 - x1) * max(0, y2 - y1)
            area_a = box_a['width'] * box_a['height']
            area_b = box_b['width'] * box_b['height']
            min_area = min(area_a, area_b)
            
            # IoMin (Containment) - The core metric
            io_min = inter_area / float(min_area) if min_area > 0 else 0
            
            # Embedding Distance
            dist = 2.0 # Max dist default
            if embedding_a and embedding_b and len(embedding_a) > 0 and len(embedding_b) > 0:
                v_a = np.array(embedding_a)
                v_b = np.array(embedding_b)
                # Normalize
                n_a = np.linalg.norm(v_a)
                n_b = np.linalg.norm(v_b)
                if n_a > 0: v_a /= n_a
                if n_b > 0: v_b /= n_b
                dist = np.linalg.norm(v_a - v_b)
            
            # [Logic Step 2] Decision Tree
            
            # RULE A: The "Physics" Rule (High Overlap > 90%)
            # RULE A: The "Physics" Rule (High Overlap > 90%)
            if io_min > 0.90:
                # [Phase 72 Fix] Mother+Baby Containment Exception
                # If one face is inside another (IoMin=1.0) but they are CLEARLY DIFFERENT people (Dist > 1.0),
                # we must keep both (Concentric Faces).
                if dist > 1.0:
                    # [Phase 74 Enhancement] Check quality scores
                    q_a = f.get('faceQuality', 0)
                    q_b = existing.get('faceQuality', 0)
                    # [Phase 74] Load from centralized config
                    from config import AI_CONFIG
                    high_quality_threshold = AI_CONFIG.get('face_detection', {}).get('high_quality_face_threshold', 0.70)
                    
                    if q_a > high_quality_threshold and q_b > high_quality_threshold:
                        # Both high quality - keep both (Mother+Baby scenario)
                        should_merge = False
                        logger.info(f"[NMS] Physics Rule Exception: High Overlap ({io_min:.2f}) but Distinct Identity (Dist={dist:.2f}) and Both High Quality (QA={q_a:.2f}, QB={q_b:.2f}). Keeping Separate.")
                        break  # [Phase 74 CRITICAL FIX] Prevent fallthrough to else block

                    else:
                        # One is low quality - merge (ghost filtering)
                        should_merge = True
                        logger.info(f"[NMS] Physics Rule Merge: High Overlap ({io_min:.2f}), Distinct Identity (Dist={dist:.2f}), but Low Quality (QA={q_a:.2f}, QB={q_b:.2f}). Merging.")
                        break
                else:
                    should_merge = True
                    logger.info(f"[NMS] RESOLVED by Physics Rule (>90% overlap): IoMin={io_min:.2f}. Merging.")
                    
                    # [Optimization] Prefer Upright
                    if rotation_a == 0 and rotation_b != 0:
                        existing.update(f) 
                        logger.info(f"[NMS] Prefer Upright: Replaced Rotated({rotation_b}) with Upright({rotation_a})")
                    break

            # RULE B: The "Trash / Ghost" Rule (Medium Overlap > 60%)
            if io_min > 0.60:
                # If they are different people...
                threshold = threshold_strict if rotation_a == rotation_b else threshold_lax
                if dist > threshold:
                    # [Phase 74 Fix] High Quality Exception
                    # If BOTH faces are high quality (> 0.70), they are likely distinct valid faces
                    # (e.g., Mother + Baby). Do NOT merge.
                    q_a = f.get('faceQuality', 0)
                    q_b = existing.get('faceQuality', 0)
                    # [Phase 74] Load from centralized config
                    from config import AI_CONFIG
                    high_quality_threshold = AI_CONFIG.get('face_detection', {}).get('high_quality_face_threshold', 0.70)
                    
                    if q_a > high_quality_threshold and q_b > high_quality_threshold:
                        # Both are high quality - keep both (likely Mother+Baby scenario)
                        should_merge = False
                        logger.info(f"[NMS] High Quality Exception: Both faces are high quality (QA={q_a:.2f}, QB={q_b:.2f}). Keeping Separate despite overlap ({io_min:.2f}).")
                        break  # [Phase 74 CRITICAL FIX] Prevent fallthrough

                    else:
                        # One is likely trash/ghost - merge (keep existing higher quality)
                        should_merge = True
                        logger.info(f"[NMS] RESOLVED by Quality Rule (>60% overlap, diff people): Dist={dist:.2f}, QA={q_a:.2f}, QB={q_b:.2f}. Keeping existing (Better Quality).")
                        break

            # RULE C: Standard Overlap (>30%)
            nms_threshold = config.get('nmsIouThresh', 0.3)
            if io_min > nms_threshold and not should_merge:
                # [Phase 73 Fix] Strict Distance Check for Low Overlap
                # If overlap is low (e.g. 0.45), be VERY strict about identity.
                # Only merge if Dist < 0.8 (Same Person Confirmed).
                # The old 1.4/1.5 thresholds were too lax for close-proximity distinct faces.
                
                strict_dist_limit = 0.8 
                
                # Exception: higher overlap (Dedup Threshold) allows looser distance
                dedup_threshold = config.get('deduplication_iou_threshold', 0.55)
                if io_min > dedup_threshold:
                     strict_dist_limit = threshold_strict if rotation_a == rotation_b else threshold_lax

                if dist < strict_dist_limit:
                     should_merge_c = True
                     
                     # No Ambiguous Logic needed if we force strict distance
                     logger.info(f"[NMS] Merging Standard Duplicate: IoMin={io_min:.2f}, Dist={dist:.2f} < {strict_dist_limit}")
                     should_merge = True # Direct merge
                     pass
                else:
                     logger.info(f"[NMS] Prevented Merge (Standard Overlap): Dist={dist:.2f} >= {strict_dist_limit}. Keeping Separate.")
                     should_merge_c = False

                     if should_merge_c:
                         # Check Vetoes (Age/Gender)
                         age_a = f.get('estimatedAge')
                         age_b = existing.get('estimatedAge')
                         gender_a = f.get('gender')
                         gender_b = existing.get('gender')
                         
                         veto = False
                         
                         # Gender Veto
                         if gender_a and gender_b and gender_a != gender_b:
                             veto = True
                             logger.info(f"[NMS] Vetoed Merge: Gender Mismatch ({gender_a} vs {gender_b})")
                             
                         # Age Veto (>15 years)
                         if age_a and age_b and abs(age_a - age_b) > 15:
                             veto = True
                             logger.info(f"[NMS] Vetoed Merge: Age Mismatch ({age_a} vs {age_b})")
                         
                         if not veto:
                             should_merge = True
                             logger.info(f"[NMS] Merged Standard Duplicate: IoMin={io_min:.2f}, Dist={dist:.2f}")
                             break
                     else:
                         logger.info(f"[NMS Debug] Merge Rejected by Logic: IoMin={io_min:.2f}, Dist={dist:.2f}")
        
        if not should_merge:
            unique_faces.append(f)
            
    return unique_faces
