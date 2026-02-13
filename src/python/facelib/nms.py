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
            if io_min > 0.9 and area_large > area_small * 1.15:
                # Check embedding distance - are they different people?
                dist = 2.0
                if emb_large and emb_small and len(emb_large) > 0 and len(emb_small) > 0:
                    v_a = np.array(emb_large)
                    v_b = np.array(emb_small)
                    n_a = np.linalg.norm(v_a)
                    n_b = np.linalg.norm(v_b)
                    if n_a > 0: v_a /= n_a
                    if n_b > 0: v_b /= n_b
                    dist = np.linalg.norm(v_a - v_b)
                
                # If different people AND small face is high quality
                if dist > 1.0 and q_small > high_quality_threshold:
                    # [Phase 86 Fix] Box Quality Arbitration
                    # Only reject the large box if it is significantly LOWER quality than the small box.
                    # If the large box is high quality (e.g. 0.90), it might be the "Full Face" vs "Partial Face".
                    # In the reported case: Large(0.90) contains Small(0.77). We should KEEP Large.
                    
                    if q_large < q_small:
                        logger.info(f"[NMS] Container Rejection: Large box ({box_large['width']}x{box_large['height']}, Q={q_large:.2f}) contains smaller face ({box_small['width']}x{box_small['height']}, Q={q_small:.2f}). Dist={dist:.2f}. Rejecting large box (Worse Quality).")
                        container_ids_to_remove.add(i)
                        break
                    else:
                        # [Phase 88.5] Geometric Safety for Confirmed Distinct Faces:
                        # If they are different people (Dist > 1.0) and both high quality, 
                        # we usually want to keep both (Mother+Baby) UNLESS they are concentric artifacts.
                        
                        cx_l = box_large['x'] + box_large['width'] / 2
                        cy_l = box_large['y'] + box_large['height'] / 2
                        cx_s = box_small['x'] + box_small['width'] / 2
                        cy_s = box_small['y'] + box_small['height'] / 2
                        c_dist = ((cx_l - cx_s)**2 + (cy_l - cy_s)**2)**0.5
                        avg_sz = (box_large['width'] + box_large['height'] + box_small['width'] + box_small['height']) / 4
                        norm_c_dist = c_dist / avg_sz if avg_sz > 0 else 0
                        
                        # Scale Exception:
                        # Mother+Baby often has the baby's face effectively "inside" the mother's bounding box 
                        # (if mother is holding baby close to chest/neck), and centers can be very close.
                        # If size difference is HUGE (e.g. > 3x area), it's likely a valid sub-face, not a duplicate crop.
                        area_l = box_large['width'] * box_large['height']
                        area_s = box_small['width'] * box_small['height']
                        scale_ratio = area_l / area_s if area_s > 0 else 1.0
                        
                        # [Phase 88.6] Refined Preservation:
                        # Keep if:
                        # 1. Centers are distinct (NormDist > 0.25) OR
                        # 2. Scale is distinct (Ratio > 3.0) AND Very Distinct Identity (Dist > 1.1)
                        
                        if norm_c_dist > 0.25 or (scale_ratio > 3.0 and dist > 1.1):
                             logger.info(f"[NMS] Container Preservation PREVENTED: High Quality Distinct Faces. NormDist={norm_c_dist:.2f}, ScaleRatio={scale_ratio:.1f}, Dist={dist:.2f}. Keeping both (Mother+Baby).")
                             container_ids_to_remove.discard(j) # Ensure we don't remove it
                             # Do nothing, let main loop handle it
                        else:
                            logger.info(f"[NMS] Container Preservation: Large box ({box_large['width']}x{box_large['height']}, Q={q_large:.2f}) contains smaller face ({box_small['width']}x{box_small['height']}, Q={q_small:.2f}). Dist={dist:.2f}, NormCenterDist={norm_c_dist:.2f}, ScaleRatio={scale_ratio:.1f}. Keeping large box (Better/Equal Quality) and removing concentric small box.")
                            container_ids_to_remove.add(j)
    
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
            union_area = area_a + area_b - inter_area
            
            # IoMin (Containment) - The core metric for logic Rule A/B
            io_min = inter_area / float(min_area) if min_area > 0 else 0
            
            # IoU (Standard Intersection over Union) - For Rule C
            iou = inter_area / float(union_area) if union_area > 0 else 0
            
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
            
            # RULE A: The "Physics" Rule (High Containment > 90%)
            # This handles duplicates from different zoom levels/crops
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
                        # [Phase 88.5] Geometric Veto:
                        # Even if they look different (Dist > 1.0), force merge if:
                        # 1. Extreme Overlap (IoU > 0.75)
                        # 2. Concentric/Close Centers (NormDist < 0.25)
                        
                        # Calculate Center Distance
                        cx_a = box_a['x'] + box_a['width'] / 2
                        cy_a = box_a['y'] + box_a['height'] / 2
                        cx_b = box_b['x'] + box_b['width'] / 2
                        cy_b = box_b['y'] + box_b['height'] / 2
                        center_dist = ((cx_a - cx_b)**2 + (cy_a - cy_b)**2)**0.5
                        avg_size = (box_a['width'] + box_a['height'] + box_b['width'] + box_b['height']) / 4
                        norm_center_dist = center_dist / avg_size if avg_size > 0 else 0
                        
                        # [Phase 88.6] Refined Center Distance Logic
                        # Force Merge if Geometric Duplicate (High IoU OR Close Centers)
                        # UNLESS it's a valid "Sub-Face" (Huge Scale Diff + Distinct Identity)
                        
                        area_a = box_a['width'] * box_a['height']
                        area_b = box_b['width'] * box_b['height']
                        scale_ratio = max(area_a, area_b) / min(area_a, area_b) if min(area_a, area_b) > 0 else 1.0

                        is_geometric_duplicate = iou > 0.75 or norm_center_dist < 0.25
                        is_likely_subface = scale_ratio > 3.0 and dist > 1.1
                        
                        if is_geometric_duplicate and not is_likely_subface:
                            should_merge = True
                            logger.info(f"[NMS] Physics Rule Force Merge: High Quality but Geometric Duplicate. IoU={iou:.2f}, NormCenterDist={norm_center_dist:.2f}. Merging.")
                            break
                        
                        # Both high quality & distinct space - keep both (Mother+Baby scenario)
                        should_merge = False
                        logger.info(f"[NMS] Physics Rule Exception: High Overlap (IoMin={io_min:.2f}) but Distinct Identity (Dist={dist:.2f}) and Both High Quality (QA={q_a:.2f}, QB={q_b:.2f}). Keeping Separate.")
                        break  # [Phase 74 CRITICAL FIX] Prevent fallthrough to else block

                    else:
                        # One is low quality - merge (ghost filtering)
                        should_merge = True
                        logger.info(f"[NMS] Physics Rule Merge: High Overlap (IoMin={io_min:.2f}), Distinct Identity (Dist={dist:.2f}), but Low Quality (QA={q_a:.2f}, QB={q_b:.2f}). Merging.")
                        break
                else:
                    should_merge = True
                    logger.info(f"[NMS] RESOLVED by Physics Rule (>90% containment): IoMin={io_min:.2f}. Merging.")
                    
                    # [Optimization] Prefer Upright
                    if rotation_a == 0 and rotation_b != 0:
                        existing.update(f) 
                        logger.info(f"[NMS] Prefer Upright: Replaced Rotated({rotation_b}) with Upright({rotation_a})")
                    break

            # RULE B: The "Trash / Ghost" Rule (Medium Containment > 60%)
            # Often handles artifacts
            if io_min > 0.60:
                # [Phase 77 Fix] Stacked Face Protection (Mother/Baby)
                logger.info(f"[NMS Debug] checking Rule B: IoMin={io_min:.2f}, IoU={iou:.2f}, Dist={dist:.2f}")
                
                if iou < 0.50 and dist > 0.8:
                     # [Phase 88.6] Geometric Check for Stacked Faces
                     # Even if IoU is low, if centers are concentric, it's a duplicate (just different zoom).
                     # UNLESS it's a valid subface (Scale Ratio > 3.0).
                     
                     # Recalculate metrics locally
                     cx_a = box_a['x'] + box_a['width'] / 2
                     cy_a = box_a['y'] + box_a['height'] / 2
                     cx_b = box_b['x'] + box_b['width'] / 2
                     cy_b = box_b['y'] + box_b['height'] / 2
                     center_dist = ((cx_a - cx_b)**2 + (cy_a - cy_b)**2)**0.5
                     avg_size = (box_a['width'] + box_a['height'] + box_b['width'] + box_b['height']) / 4
                     norm_center_dist = center_dist / avg_size if avg_size > 0 else 0
                     
                     area_a = box_a['width'] * box_a['height']
                     area_b = box_b['width'] * box_b['height']
                     scale_ratio = max(area_a, area_b) / min(area_a, area_b) if min(area_a, area_b) > 0 else 1.0

                     if norm_center_dist < 0.25 and scale_ratio < 3.0:
                          should_merge = True
                          logger.info(f"[NMS] Stacked Face Protection VETOED: Concentric Duplicate. NormDist={norm_center_dist:.2f}, ScaleRatio={scale_ratio:.1f}. Merging.")
                          break
                     
                     logger.info(f"[NMS] Stacked Face Protected: IoMin={io_min:.2f} but IoU={iou:.2f} (Low). Dist={dist:.2f}. Keeping Separate.")
                     should_merge = False
                     # Skip the rest of Rule B
                else: 
                    # Proceed with Ghost/Quality Logic
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
                            # [Phase 88.5] Geometric Veto
                            
                            # Calculate Center Distance (re-calc as scope is different or variable reuse)
                            cx_a = box_a['x'] + box_a['width'] / 2
                            cy_a = box_a['y'] + box_a['height'] / 2
                            cx_b = box_b['x'] + box_b['width'] / 2
                            cy_b = box_b['y'] + box_b['height'] / 2
                            center_dist = ((cx_a - cx_b)**2 + (cy_a - cy_b)**2)**0.5
                            avg_size = (box_a['width'] + box_a['height'] + box_b['width'] + box_b['height']) / 4
                            norm_center_dist = center_dist / avg_size if avg_size > 0 else 0

                            # [Phase 88.6] Refined Center Distance Logic
                            area_a = box_a['width'] * box_a['height']
                            area_b = box_b['width'] * box_b['height']
                            scale_ratio = max(area_a, area_b) / min(area_a, area_b) if min(area_a, area_b) > 0 else 1.0

                            is_geometric_duplicate = iou > 0.75 or norm_center_dist < 0.25
                            is_likely_subface = scale_ratio > 3.0 and dist > 1.1

                            if is_geometric_duplicate and not is_likely_subface:
                                should_merge = True
                                logger.info(f"[NMS] High Quality Exception Force Merge: Geometric Duplicate. IoU={iou:.2f}, NormCenterDist={norm_center_dist:.2f}. Merging.")
                                break

                            # Both are high quality - keep both (likely Mother+Baby scenario)
                            should_merge = False
                            logger.info(f"[NMS] High Quality Exception: Both faces are high quality (QA={q_a:.2f}, QB={q_b:.2f}). Keeping Separate despite containment (IoMin={io_min:.2f}).")
                            break  # [Phase 74 CRITICAL FIX] Prevent fallthrough
    
                        else:
                            # One is likely trash/ghost - merge (keep existing higher quality)
                            should_merge = True
                            logger.info(f"[NMS] RESOLVED by Quality Rule (>60% containment, diff people): Dist={dist:.2f}, QA={q_a:.2f}, QB={q_b:.2f}. Keeping existing (Better Quality).")
                            break

            # RULE C: Standard Overlap (IoU Check)
            # [FIX] Use IoU instead of IoMin for standard NMS.
            # IoMin handles containment (face inside face), IoU handles overlap (stacked faces).
            # Stacked faces (Mother Holding Baby) have high IoMin (50%+) but low IoU (20-30%).
            nms_threshold = config.get('nmsIouThresh', 0.3)
            
            if iou > nms_threshold and not should_merge:
                # [Phase 73 Fix] Strict Distance Check for Low Overlap
                # If overlap is low (e.g. 0.45), be VERY strict about identity.
                # Only merge if Dist < 0.8 (Same Person Confirmed).
                
                strict_dist_limit = 0.8 
                
                # Exception: higher overlap (Dedup Threshold) allows looser distance
                dedup_threshold = config.get('deduplication_iou_threshold', 0.55)
                if iou > dedup_threshold:
                     strict_dist_limit = threshold_strict if rotation_a == rotation_b else threshold_lax

                if dist < strict_dist_limit:
                     should_merge_c = True
                     logger.info(f"[NMS] Merging Standard Duplicate: IoU={iou:.2f}, Dist={dist:.2f} < {strict_dist_limit}")
                     should_merge = True # Direct merge
                     break
                else:
                     logger.info(f"[NMS] Prevented Merge (Standard Overlap): Dist={dist:.2f} >= {strict_dist_limit}. Keeping Separate.")
                     should_merge_c = False

                     # Veto code removed as unnecessary if we trust distance
                     logger.info(f"[NMS Debug] Merge Rejected by Distance: IoU={iou:.2f}, Dist={dist:.2f}")
        
        if not should_merge:
            unique_faces.append(f)
            
    return unique_faces
