import sys
import json
import logging
import time
import os
import os
import cv2
import numpy as np
import rawpy
import tempfile
from io import BytesIO
import base64
import requests

# Configure PyTorch Allocator for Windows to prevent expandable_segments warning
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:False"

# Internal Modules
import facelib.faces as faces
import facelib.vlm as vlm
import facelib.utils as utils
import facelib.vector_store as vector_store
import facelib.image_ops as image_ops
import enhance # Local module

# Configure logging
logger = utils.configure_logging()

# --- INITIALIZATION ---
# Initial Runtime Check
utils.inject_runtime()

# Initial Checks (Lazy Loaders)
torch_lib = utils.get_torch()
# faces.init_insightface() # Lazy init in command
vector_store.init_faiss()

# --- HELPER FUNCTIONS (Specific to Orchestration/API) ---

# Simple single-item cache for batch processing
_img_cache = {"path": None, "img": None, "timestamp": 0}

def load_image_cv2(file_path):
    """Loads an image into OpenCV BGR format with robust fallback and caching."""
    global _img_cache
    
    # Check cache
    if _img_cache["path"] == file_path and _img_cache["img"] is not None:
        # logger.debug(f"Image cache hit: {file_path}")
        return _img_cache["img"]
        
    try:
        ext = os.path.splitext(file_path)[1].lower()
        is_raw = ext in ['.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.kdc', '.mrw']
        from PIL import Image, ImageFile, ImageOps as PILImageOps
        ImageFile.LOAD_TRUNCATED_IMAGES = True
        
        try:
            # PIL often loads the embedded JPEG preview for RAWs, which is low res.
            # Force RawPy for legitimate RAW files.
            if is_raw:
                 raise Exception("Force RawPy for RAW file")

            pil_img = Image.open(file_path)
            pil_img = PILImageOps.exif_transpose(pil_img)
            rgb_img = np.array(pil_img)
            
            if len(rgb_img.shape) == 2:
                 rgb_img = cv2.cvtColor(rgb_img, cv2.COLOR_GRAY2RGB)
            elif rgb_img.shape[2] == 4:
                 rgb_img = cv2.cvtColor(rgb_img, cv2.COLOR_RGBA2RGB)
                 
            img = cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)
            
            # Check if PIL returned a tiny thumbnail (common with some RAW loaders)
            h, w = img.shape[:2]
            if is_raw and max(h, w) < 1000:
                 logger.warning(f"PIL loaded small preview ({w}x{h}) for RAW. Retrying with RawPy.")
                 raise Exception("PIL thumbnail detected")
            
            # Update cache
            _img_cache["path"] = file_path
            _img_cache["img"] = img
            _img_cache["timestamp"] = time.time()
            
            return img
        except Exception as e:
            # logger.warning(f"PIL Load failed: {e}. Trying RawPy...")
            try:
                with rawpy.imread(file_path) as raw:
                    # RawPy postprocess is high quality
                    rgb = raw.postprocess(use_camera_wb=True)
                    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
                    
                    # Update cache
                    _img_cache["path"] = file_path
                    _img_cache["img"] = img
                    _img_cache["timestamp"] = time.time()
                    
                    return img
            except Exception as raw_e:
                logger.warning(f"RawPy failed to load {os.path.basename(file_path)}: {raw_e}. Falling back to standard PIL (Embedded Preview).")
                
                # FINAL FALLBACK: Try to load whatever PIL can find (usually embedded JPEG)
                # We simply repeat the PIL logic but WITHOUT the 'is_raw' check/raise
                try:
                    pil_img = Image.open(file_path)
                    pil_img = PILImageOps.exif_transpose(pil_img)
                    rgb_img = np.array(pil_img)
                    
                    if len(rgb_img.shape) == 2:
                        rgb_img = cv2.cvtColor(rgb_img, cv2.COLOR_GRAY2RGB)
                    elif rgb_img.shape[2] == 4:
                        rgb_img = cv2.cvtColor(rgb_img, cv2.COLOR_RGBA2RGB)
                        
                    img = cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)
                    
                    # Update cache
                    _img_cache["path"] = file_path
                    _img_cache["img"] = img
                    _img_cache["timestamp"] = time.time()
                    return img
                except Exception as final_e:
                    logger.error(f"Fatal: All loading methods failed for {file_path}: {final_e}")
                    return None
    except Exception as e:
        logger.error(f"Failed to load image: {e}")
        return None

# --- COMMAND HANDLER ---

def handle_command(command):
    cmd_type = command.get('type')
    payload = command.get('payload', {})
    req_id = payload.get('reqId')
    
    # Silent/Debug commands
    debug_commands = ['generate_thumbnail', 'ping', 'get_system_status', 'batch_search_index']
    if cmd_type in debug_commands:
        logger.debug(f"Received command: {cmd_type}")
    else:
        logger.info(f"Received command: {cmd_type}")

    response = {}
    if req_id:
         response['reqId'] = req_id

    if cmd_type == 'ping':
        response = {
            "type": "pong", 
            "timestamp": time.time(),
            "aiMode": faces.AI_MODE,
            "vlmEnabled": vlm.VLM_ENABLED if hasattr(vlm, 'VLM_ENABLED') else (utils.get_torch() is not None)
        }




    elif cmd_type == 'health_check':
        response = {
            "type": "health_check", 
            "status": "ok",
        }
        
        try:
            # 1. Models Status (Transparent listing)
            models_info = {}
            
            # Special markers for core libraries
            runtime_exists = os.path.exists(os.path.join(os.environ.get('LIBRARY_PATH', os.path.expanduser('~/.smart-photo-organizer')), 'ai-runtime'))
            
            # Use dynamic URL if provided, otherwise default (though default might be outdated if version mismatch)
            runtime_url = payload.get('runtimeUrl', "https://github.com/arozz7/smart-photo-organizer/releases/download/v0.3.0/ai-runtime-win-x64.zip")
            
            models_info["AI GPU Runtime (Torch/CUDA)"] = {
                "exists": runtime_exists,
                "url": runtime_url,
                "size": 5800000000, # Approx 5.8GB
                "localPath": os.path.join(os.environ.get('LIBRARY_PATH', os.path.expanduser('~/.smart-photo-organizer')), 'ai-runtime'),
                "isRuntime": True
            }

            for name, url in enhance.MODEL_URLS.items():
                m_path = os.path.join(enhance.WEIGHTS_DIR, f"{name}.pth")
                exists = os.path.exists(m_path)
                models_info[name] = {
                    "exists": exists,
                    "url": url,
                    "size": os.path.getsize(m_path) if exists else 0,
                    "localPath": m_path
                }
            
            # Special markers for core models
            models_info["Buffalo_L (InsightFace)"] = {
                "exists": os.path.exists(os.path.expanduser('~/.insightface/models/buffalo_l')),
                "url": "InsightFace Internal (Buffalo_L)",
                "size": 0,
                "localPath": os.path.expanduser('~/.insightface/models/buffalo_l')
            }
            models_info["SmolVLM-Instruct"] = {
                "exists": os.path.exists(os.path.expanduser('~/.cache/huggingface/hub/models--HuggingFaceTB--SmolVLM-Instruct')),
                "url": "HuggingFace (SmolVLM-Instruct)",
                "size": 0,
                "localPath": os.path.expanduser('~/.cache/huggingface/hub/models--HuggingFaceTB--SmolVLM-Instruct')
            }
            response['models'] = models_info

            # 2. InsightFace Status
            insightface_status = {'loaded': False}
            if faces.app:
                providers = []
                try:
                    if hasattr(faces.app, 'models') and 'detection' in faces.app.models:
                        det_model = faces.app.models['detection']
                        if hasattr(det_model, 'session'):
                            providers = det_model.session.get_providers()
                except Exception:
                    providers = ["Unknown"]
                insightface_status = {'loaded': True, 'providers': providers}
            response['insightface'] = insightface_status
            
        except Exception as e:
            logger.error(f"Health Check Partial Error: {e}")
            # Fallback
            response['models'] = response.get('models', {})


    elif cmd_type == 'update_config':
        config = payload.get('config', {})
        logger.info(f"Updating Config: {config}")
        
        if 'faceDetectionThreshold' in config:
            faces.DET_THRESH = float(config['faceDetectionThreshold'])
            # Re-prepare app if needed
            if faces.app:
                try:
                    faces.app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=faces.DET_THRESH)
                except: pass

        if 'faceBlurThreshold' in config:
            # Note: BLUR_THRESH was global in main.py. 
            # We need to decide where it lives. It's used in analyze_image logic.
            # We can store it in faces module or keep it here if it's orchestrator logic.
            # Let's assume it was orchestrator logic for filtering results.
            # But wait, analyze_image is here. So we can keep a global here or use a config dict.
            # Better: Store in faces module? No, blur is image op.
            # Let's strictly use a local variable passed to logic?
            # For now, let's keep a global CONFIG dict in main.py for orchestrator settings.
            CONFIG['faceBlurThreshold'] = float(config['faceBlurThreshold'])
            
        if 'vlmTemperature' in config:
            vlm.VLM_TEMP = float(config['vlmTemperature'])
            
        if 'vlmMaxTokens' in config:
            vlm.VLM_MAX_TOKENS = int(config['vlmMaxTokens'])
            
        if 'vlmEnabled' in config and config['vlmEnabled'] is True:
             logger.info("Enabling VLM (Lazy Load)...")
             # vlm.init_vlm() # Keep lazy! Don't init here.

        response = {"type": "config_updated"}

    elif cmd_type == 'save_index':
        try:
            vector_store.save_faiss()
            response = {"type": "save_index_result", "success": True}
        except Exception as e:
            logger.error(f"Failed to save index: {e}")
            response = {"type": "save_index_result", "success": False, "error": str(e)}

    elif cmd_type == 'add_to_index':
        vectors = payload.get('vectors', [])
        ids = payload.get('ids', [])
        
        try:
            if vectors and len(vectors) == len(ids):
                count = vector_store.add_vectors(vectors, ids)
                response = {"type": "add_to_index_result", "success": True, "count": count}
            else:
                 response = {"type": "add_to_index_result", "success": False, "error": "Mismatch in vectors/ids length"}
        except Exception as e:
            logger.error(f"Failed to add to index: {e}")
            response = {"type": "add_to_index_result", "success": False, "error": str(e)}

    elif cmd_type == 'generate_thumbnail':
        path_str = payload.get('filePath') or payload.get('path')
        width = payload.get('width', 300)
        box = payload.get('box') 
        orientation = payload.get('orientation', 1) # Default 1 (Normal)

        logger.debug(f"Generating thumbnail for: {path_str} (Box: {box}, Ori: {orientation})")
        try:
            from PIL import Image, ImageFile, ImageOps as PILImageOps
            ImageFile.LOAD_TRUNCATED_IMAGES = True
            raw_scale_x, raw_scale_y = 1.0, 1.0
            try:
                pil_img = Image.open(path_str)
                pil_img = PILImageOps.exif_transpose(pil_img)
            except Exception as e:
                try:
                    logger.debug("PIL load failed, trying rawpy...")
                    with rawpy.imread(path_str) as raw:
                        # Capture original dimensions
                        raw_w = raw.sizes.width
                        raw_h = raw.sizes.height
                        
                        # Optimization: Try to use embedded thumbnail first
                        try:
                            thumb = raw.extract_thumb()
                        except:
                            thumb = None
                        
                        if thumb and thumb.format == rawpy.ThumbFormat.JPEG:
                             # Use embedded JPEG
                             logger.debug("Using embedded RAW thumbnail")
                             candidate_img = Image.open(BytesIO(thumb.data))
                             
                             # [Phase 53] Quality Check: Reject small embedded thumbs
                             if max(candidate_img.size) < 1200:
                                 logger.debug(f"Embedded thumbnail too small ({candidate_img.size}), forcing full RAW conversion.")
                                 pil_img = None # Trigger fallback
                             else:
                                 pil_img = candidate_img
                                 # Recalculate scale if thumb is smaller
                                 if pil_img.width != raw_w or pil_img.height != raw_h:
                                     raw_scale_x = pil_img.width / raw_w
                                     raw_scale_y = pil_img.height / raw_h
                                     logger.debug(f"Applied RAW Scale: {raw_scale_x:.3f}, {raw_scale_y:.3f}")
                                     
                        elif thumb and thumb.format == rawpy.ThumbFormat.BITMAP:
                             # Use embedded Bitmap
                             logger.debug("Using embedded RAW bitmap thumbnail")
                             candidate_img = Image.fromarray(thumb.data)
                             if max(candidate_img.size) < 1200:
                                 pil_img = None
                             else:
                                 pil_img = candidate_img
                                 if pil_img.width != raw_w or pil_img.height != raw_h:
                                     raw_scale_x = pil_img.width / raw_w
                                     raw_scale_y = pil_img.height / raw_h
                        else:
                             pil_img = None

                        if pil_img is None:
                             # Fallback to full conversion (Slow)
                             logger.debug("Full RAW conversion (slow)")
                             rgb = raw.postprocess(use_camera_wb=True, bright=1.0, user_sat=None) # bright=1.0 default
                             pil_img = Image.fromarray(rgb)
                except Exception as raw_e:
                     raise ValueError(f"Failed to load image: {e} | {raw_e}")

            if pil_img:
                # --- Conditional Rotation Fix ---
                # Check dimensions vs Orientation
                w, h = pil_img.size
                is_landscape_dims = w > h
                expects_portrait = (orientation == 6 or orientation == 8)
                
                # If we rotate 90/270, we need to swap the scale factors
                swapped_dims = False

                if expects_portrait and is_landscape_dims:
                    # logger.debug(f"Thumb Gen: Orientation {orientation} (Portrait) but Image is {w}x{h}. Rotating.")
                    if orientation == 6:
                        # Orientation 6 (Right Top) -> Needs 90 CW to be Upright
                        pil_img = pil_img.rotate(-90, expand=True) 
                        swapped_dims = True
                    elif orientation == 8:
                        # Orientation 8 (Left Bottom) -> Needs 90 CCW (270 CW) to be Upright
                        pil_img = pil_img.rotate(90, expand=True)
                        swapped_dims = True
                elif orientation == 3:
                     pil_img = pil_img.rotate(180, expand=True)
                
                if swapped_dims:
                    raw_scale_x, raw_scale_y = raw_scale_y, raw_scale_x
                
                img_w, img_h = pil_img.size

                # 1. Crop if requested
                if box:
                    try:
                        # Normalize box format
                        if isinstance(box, str):
                            x, y, w, h = map(int, box.split(','))
                        elif isinstance(box, dict):
                            x, y, w, h = int(box['x']), int(box['y']), int(box['width']), int(box['height'])
                        elif isinstance(box, list):
                            x, y, w, h = map(int, box)
                        
                        # Apply RAW Scaling (if any)
                        if raw_scale_x != 1.0 or raw_scale_y != 1.0:
                            x = int(x * raw_scale_x)
                            y = int(y * raw_scale_y)
                            w = int(w * raw_scale_x)
                            h = int(h * raw_scale_y)

                        x = max(0, min(x, img_w - 1))
                        y = max(0, min(y, img_h - 1))
                        w = max(1, min(w, img_w - x))
                        h = max(1, min(h, img_h - y))
                        
                        pil_img = pil_img.crop((x, y, x + w, y + h))
                    except Exception as e:
                        logger.warning(f"Crop failed: {e}")

                # 2. Resize
                pil_img.thumbnail((width, width))
                if pil_img.mode in ('RGBA', 'P'):
                    pil_img = pil_img.convert('RGB')
                
                buffered = BytesIO()
                pil_img.save(buffered, format="JPEG", quality=80)
                img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
                
                response = {
                    "type": "thumbnail_result", 
                    "success": True, 
                    "data": img_str,
                    "contentType": "image/jpeg"
                }
        except Exception as e:
            logger.error(f"Thumbnail generation failed: {e}")
            response = {"type": "thumbnail_result", "success": False, "error": str(e)}

    elif cmd_type == 'save_vector_index':
        try:
            vector_store.save_faiss()
            response = {"success": True}
        except Exception as e:
            logger.error(f"Failed to save index: {e}")
            response = {"success": False, "error": str(e)}

    elif cmd_type == 'add_faces_to_vector_index':
        face_list = payload.get('faces', [])
        logger.debug(f"Adding {len(face_list)} faces to FAISS index.")
        try:
            new_vectors = []
            new_ids = []
            
            for f in face_list:
                if 'descriptor' in f and f['descriptor']:
                     desc = f['descriptor']
                     if isinstance(desc, list):
                         new_vectors.append(desc)
                         new_ids.append(f['id'])
            
            if new_vectors:
                count = vector_store.add_vectors(new_vectors, new_ids)
                vector_store.save_faiss() # Persistent index
                response = {"success": True, "count": count}
            else:
                 response = {"success": True, "count": 0}

        except Exception as e:
            logger.error(f"Failed to add faces to index: {e}")
            response = {"success": False, "error": str(e)}

    elif cmd_type == 'analyze_image':

        t_start = time.time()
        
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        scan_mode = payload.get('scanMode', 'FAST')
        enable_vlm = payload.get('enableVLM', False)
        orientation = payload.get('orientation', 1) # Default 1 (Normal)
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
        img = load_image_cv2(file_path)

        if img is None:
            response = {"type": "analysis_result", "photoId": photo_id, "error": f"Image Load Failed", "scanMode": scan_mode}
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
        elif orientation == 3: # 180 Rotation (Landscape -> Landscape)
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
                det_thresh = 0.5 # Slightly lower for balanced/fast
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
            all_detections = [] # List of (face_obj, scan_scale)

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
                        if max_h > (img_h * 0.15): # >15% of image height
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
                    continue # Skip blurry

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
                
                scan_results.append({
                    "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                    "descriptor": face.embedding.tolist() if hasattr(face, 'embedding') else [],
                    "score": float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                    "blurScore": float(f_blur),
                    "poseYaw": pose_yaw,
                    "posePitch": pose_pitch,
                    "poseRoll": pose_roll,
                    "faceQuality": face_quality,
                    # Age-Based ERA Categorization: Extract age and gender from genderage module
                    "estimatedAge": int(face.age) if hasattr(face, 'age') and face.age is not None else None,
                    "gender": "M" if hasattr(face, 'sex') and face.sex == "M" else ("F" if hasattr(face, 'sex') and face.sex == "F" else None),
                    "scan_source": f"{scan_source_size}px", # Debug info
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

                    faces.init_insightface(providers=faces.CURRENT_PROVIDERS, allowed_modules=faces.ALLOWED_MODULES, det_size=target_size, det_thresh=safe_thresh) # Re-init params with SAFE thresh
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
                            
                            if rot_angle == 90: # 90 CW
                                pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                                orig_pts = [(py, orig_h - px) for px, py in pts]
                            elif rot_angle == 180:
                                pts = [(rx1, ry1), (rx2, ry2)]
                                orig_pts = [(orig_w - px, orig_h - py) for px, py in pts]
                            elif rot_angle == 270: # 90 CCW
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

                            scan_results.append({
                                "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                                "descriptor": face.embedding.tolist() if hasattr(face, 'embedding') else [],
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
                            import numpy as np
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

    elif cmd_type == 'generate_tags':
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        logger.info(f"Generating tags for {photo_id}...")
        try:
             if not vlm.vlm_model: vlm.init_vlm()
             
             if vlm.vlm_model is None:
                 logger.warning("VLM is unavailable. Skipping tagging.")
                 response = {"type": "tags_result", "photoId": photo_id, "tags": [], "description": "", "error": "VLM_UNAVAILABLE" }
             else:
                 description, tags = vlm.generate_captions(file_path)
                 response = {"type": "tags_result", "photoId": photo_id, "description": description, "tags": tags}
        except Exception as e:
            logger.exception("VLM Error")
            response = {"type": "tags_result", "photoId": photo_id, "error": str(e)}

    elif cmd_type == 'rotate_image':
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        rotation_angle = payload.get('rotation') 
        
        logger.info(f"Rotating image {photo_id} by {rotation_angle} degrees...")
        try:
            from PIL import Image, ImageFile, ImageOps as PILImageOps
            ImageFile.LOAD_TRUNCATED_IMAGES = True
            img = Image.open(file_path)
            img = PILImageOps.exif_transpose(img)
            
            angle = -int(rotation_angle)
            rotated_img = img.rotate(angle, expand=True)
            
            exif = rotated_img.getexif()
            if 0x0112 in exif: del exif[0x0112] 
            
            rotated_img.save(file_path, quality=95, exif=exif)
            full_w, full_h = rotated_img.size
            
            logger.info(f"Successfully rotated {file_path}")
            
            preview_dir = payload.get('previewStorageDir')
            if preview_dir:
                 preview_filename = f"preview_{photo_id}.jpg"
                 preview_path = os.path.join(preview_dir, preview_filename)
                 max_dim = 1280
                 if full_w > max_dim or full_h > max_dim:
                     preview_img = rotated_img.copy()
                     preview_img.thumbnail((max_dim, max_dim))
                     preview_img.save(preview_path, quality=80)
                 else:
                     rotated_img.save(preview_path, quality=80)

            response = {"type": "rotate_result", "photoId": photo_id, "success": True, "width": full_w, "height": full_h}
        except Exception as e:
            logger.error(f"Rotation Error: {e}")
            response = {"error": str(e), "photoId": photo_id}

    elif cmd_type == 'get_mean_embedding':
        descriptors = payload.get('descriptors', [])
        try:
            mean_vector = faces.calculate_mean_embedding(descriptors)
            response = {"type": "mean_embedding_result", "embedding": mean_vector}
        except Exception as e:
            response = {"error": str(e)}

    elif cmd_type == 'enhance_image':
        # Delegate to enhance module
        file_path = payload.get('filePath')
        out_path = payload.get('outPath')
        task = payload.get('task', 'upscale')
        model_name = payload.get('modelName', 'RealESRGAN_x4plus')
        face_enhance = payload.get('faceEnhance', False)
        
        logger.info(f"Enhancing image: {file_path} -> {out_path} [{task}/{model_name}]")
        try:
            result_path = enhance.enhancer.enhance(file_path, out_path, task, model_name, face_enhance)
            response = {"type": "enhance_result", "success": True, "outPath": result_path, "reqId": req_id}
        except Exception as e:
            logger.exception("Enhancement Error")
            response = {"type": "enhance_result", "success": False, "error": str(e), "reqId": req_id}

    elif cmd_type == 'download_model':
        model_name = payload.get('modelName')
        logger.info(f"Downloading model: {model_name}")
        try:
            def progress_callback(current, total):
                if total > 0:
                    pct = (current / total) * 100
                    print(json.dumps({
                        "type": "download_progress",
                        "modelName": model_name,
                        "current": current,
                        "total": total,
                        "percent": pct,
                        "reqId": req_id
                    }))
                    sys.stdout.flush()

            if "AI GPU Runtime" in model_name:
                import zipfile
                temp_zip = os.path.join(tempfile.gettempdir(), "ai-runtime.zip")
                if os.path.exists(temp_zip):
                    try: os.remove(temp_zip)
                    except: pass

                # Dynamic URL support
                base_url = payload.get('url')
                if not base_url:
                    # Fallback default if not provided (should accept version from IPC though)
                    # Note: We expect IPC to provide versioned URL now.
                    base_url = "https://github.com/arozz7/smart-photo-organizer/releases/download/v0.5.0/ai-runtime-win-x64.zip"

                # Check if this is a custom override (likely single file) or standard release (multi-part)
                # Heuristic: Try .001 first. If 404, fallback to single file.
                
                parts_downloaded = []
                part_num = 1
                multi_part_mode = False
                
                # Try .001 first
                first_part_url = f"{base_url}.001"
                logger.info(f"Checking for multi-part existence: {first_part_url}")
                
                try:
                    # quick head/get check or just try download
                    # Since we don't have a dedicated HEAD method in 'enhance' easily exposed, 
                    # let's try to download part 1.
                    part_1_path = f"{temp_zip}.001"
                    if os.path.exists(part_1_path): os.remove(part_1_path)
                    
                    try:
                        # Attempt download part 1
                        logger.info(f"Attempting download of Part 1: {first_part_url}")
                        saved_p1 = enhance.enhancer.download_model_at_url(first_part_url, part_1_path, progress_callback)
                        parts_downloaded.append(saved_p1)
                        multi_part_mode = True
                    except Exception as e:
                        logger.info(f"Part 1 not found ({e}). Assuming single file.")
                        multi_part_mode = False
                
                except:
                    multi_part_mode = False
                
                if multi_part_mode:
                    # Continue downloading subsequent parts
                    while True:
                        part_num += 1
                        next_url = f"{base_url}.{part_num:03d}"
                        next_part_path = f"{temp_zip}.{part_num:03d}"
                        if os.path.exists(next_part_path): os.remove(next_part_path)
                        
                        logger.info(f"Downloading Part {part_num}: {next_url}")
                        try:
                            saved_pn = enhance.enhancer.download_model_at_url(next_url, next_part_path, progress_callback)
                            parts_downloaded.append(saved_pn)
                        except Exception:
                            logger.info(f"Part {part_num} not found. Finished downloading parts.")
                            break
                    
                    # Concatenate
                    logger.info(f"Concatenating {len(parts_downloaded)} parts...")
                    with open(temp_zip, 'wb') as outfile:
                        for p_path in parts_downloaded:
                            with open(p_path, 'rb') as infile:
                                import shutil
                                shutil.copyfileobj(infile, outfile)
                            try: os.remove(p_path) # Cleanup part
                            except: pass
                            
                else:
                    # Single file mode (Override or legacy)
                    logger.info(f"Downloading single file: {base_url}")
                    enhance.enhancer.download_model_at_url(base_url, temp_zip, progress_callback)

                
                logger.info("Extracting AI Runtime...")
                # Signal extraction start to UI
                print(json.dumps({
                    "type": "download_progress",
                    "modelName": model_name,
                    "status": "extracting",
                    "reqId": req_id
                }))
                sys.stdout.flush()
                
                with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                    zip_ref.extractall(utils.AI_RUNTIME_PATH)
                
                if os.path.exists(temp_zip): os.remove(temp_zip)
                
                # RE-INJECT
                logger.info("Attempting to inject new runtime...")
                if utils.inject_runtime():
                    logger.info("Runtime injected. Re-initializing...")
                    # 1. Reload Torch (not easy in python without reload, but utils.get_torch might pick it up if sys.path changed)
                    # 2. Reset faces app
                    faces.app = None
                    faces.AI_MODE = "GPU" # Optimistic
                else:
                    logger.warning("Runtime injection failed after download.")
            else:
                save_path = enhance.enhancer.download_model_with_progress(model_name, progress_callback)
            
            response = {"type": "download_result", "success": True, "modelName": model_name, "savePath": str(utils.AI_RUNTIME_PATH), "reqId": req_id}
        except Exception as e:
            logger.exception("Download Error")
            response = {"type": "download_result", "success": False, "error": str(e), "reqId": req_id}

    elif cmd_type == 'rebuild_index':
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

    elif cmd_type == 'search_index':
        descriptor = payload.get('descriptor')
        k = payload.get('k', 10)
        threshold = payload.get('threshold', 0.6)
        try:
            matches = vector_store.search_index(descriptor, k, threshold)
            response = {"type": "search_result", "matches": matches, "reqId": req_id}
        except Exception as e:
            logger.exception("Search failed")
            response = {"error": str(e), "reqId": req_id}

    elif cmd_type == 'batch_search_index':
        descriptors = payload.get('descriptors', [])
        k = payload.get('k', 10)
        threshold = payload.get('threshold', 0.6)
        try:
            results = vector_store.search_index_batch(descriptors, k, threshold)
            response = {"type": "batch_search_result", "results": results, "reqId": req_id}
        except Exception as e:
            logger.exception("Batch search failed")
            response = {"error": str(e), "reqId": req_id}

    elif cmd_type == 'get_system_status':
        status = {}
        try:
            # Check Models (Robustly)
            try:
                status['models'] = utils.get_model_status(enhance.MODEL_URLS, enhance.WEIGHTS_DIR)
            except Exception as e:
                logger.error(f"Status Check (Models) failed: {e}")
                status['models'] = {"error": str(e)}

            # InsightFace
            status['insightface'] = {
                'loaded': (faces.app is not None),
                'providers': faces.CURRENT_PROVIDERS if faces.CURRENT_PROVIDERS else [],
                'det_thresh': faces.DET_THRESH
            }

            # FAISS
            try:
                status['faiss'] = {
                    'loaded': (vector_store.index is not None), 
                    'count': vector_store.index.ntotal if vector_store.index else 0,
                    'dim': (vector_store.index.d if (vector_store.index and hasattr(vector_store.index, 'd') and vector_store.index.d > 0) else 512) if vector_store.index else 0
                }
            except Exception as e:
                logger.error(f"Status Check (FAISS) failed: {e}")
                status['faiss'] = {'loaded': False, 'error': str(e)}

            # VLM
            status['vlm'] = {
                'loaded': (vlm.vlm_model is not None),
                'device': "cuda" if torch_lib and torch_lib.cuda.is_available() else "cpu",
                'model': 'SmolVLM-Instruct'
            }
            
            # System
            status['system'] = {
                'python': sys.version.split()[0],
                'torch': "Unknown",
                'cuda_available': False,
                'cuda_device': "N/A",
                'onnxruntime': "Unknown",
                'opencv': cv2.__version__ if hasattr(cv2, '__version__') else "Unknown",
                'ai_runtime_path': utils.AI_RUNTIME_PATH
            }
            try:
                import onnxruntime
                status['system']['onnxruntime'] = onnxruntime.__version__
            except: pass

            try:
                if torch_lib:
                    status['system']['torch'] = torch_lib.__version__
                    if torch_lib.cuda.is_available():
                        status['system']['cuda_available'] = True
                        status['system']['cuda_device'] = torch_lib.cuda.get_device_name(0)
            except: pass

            response = {"type": "system_status_result", "status": status, "reqId": req_id}
            
        except Exception as e:
             logger.exception("FATAL in get_system_status")
             response = {"type": "system_status_result", "error": str(e), "reqId": req_id}

    elif cmd_type == 'get_index_status':
        # Diagnostic: Get detailed FAISS index status
        try:
            index_status = {
                'loaded': (vector_store.index is not None),
                'total_vectors': vector_store.index.ntotal if vector_store.index else 0,
                'dimension': vector_store.index.d if vector_store.index else 0,
            }
            
            # Get ID mapping breakdown
            if hasattr(vector_store, 'id_map') and vector_store.id_map:
                index_status['id_map_size'] = len(vector_store.id_map)
                # Sample of IDs in index
                sample_ids = list(vector_store.id_map.values())[:20]
                index_status['sample_face_ids'] = sample_ids
            else:
                index_status['id_map_size'] = 0
                index_status['sample_face_ids'] = []
            
            response = {"type": "index_status_result", "status": index_status, "reqId": req_id}
        except Exception as e:
            logger.error(f"Get index status error: {e}")
            response = {"type": "index_status_result", "error": str(e), "reqId": req_id}

    elif cmd_type == 'cluster_faces':
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
            import numpy as np
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

    elif cmd_type == 'find_ungroupable_faces':
        faces_data = payload.get('faces', [])
        centroids = payload.get('centroids', [])
        distance_threshold = float(payload.get('distanceThreshold', 1.0))
        
        # Support file-based payload for large datasets
        if 'dataPath' in payload:
            dpath = payload['dataPath']
            if os.path.exists(dpath):
                try:
                    with open(dpath, 'r') as f:
                        file_payload = json.load(f)
                        faces_data = file_payload.get('faces', faces_data)
                        centroids = file_payload.get('centroids', centroids)
                except Exception as e:
                    logger.error(f"Failed to read data path: {e}")
        
        logger.info(f"Finding ungroupable faces from {len(faces_data)} faces (threshold: {distance_threshold})...")
        
        try:
            # Extract IDs and descriptors from faces_data
            face_ids = [f['id'] for f in faces_data]
            descriptors = [f['descriptor'] for f in faces_data]
            
            result = faces.find_ungroupable_faces(face_ids, descriptors, centroids, distance_threshold)
            response = {"type": "ungroupable_faces_result", "success": True, **result, "reqId": req_id}
        except Exception as e:
            logger.error(f"Find ungroupable faces error: {e}")
            response = {"type": "ungroupable_faces_result", "success": False, "error": str(e), "reqId": req_id}

    elif cmd_type == 'detect_background_faces':
        faces_data = payload.get('faces', [])
        centroids = payload.get('centroids', [])
        
        # Support file-based payload for large datasets
        if 'dataPath' in payload:
            dpath = payload['dataPath']
            if os.path.exists(dpath):
                try:
                    with open(dpath, 'r') as f:
                        file_payload = json.load(f)
                        faces_data = file_payload.get('faces', faces_data)
                        centroids = file_payload.get('centroids', centroids)
                except Exception as e:
                    logger.error(f"Failed to read data path: {e}")
        
        # Thresholds from settings (with defaults)
        min_photo_appearances = payload.get('minPhotoAppearances', 3)
        max_cluster_size = payload.get('maxClusterSize', 2)
        distance_threshold = payload.get('centroidDistanceThreshold', 0.7)
        
        logger.info(f"Detecting background faces from {len(faces_data)} unnamed faces (centroids: {len(centroids)})...")
        
        try:
            result = faces.detect_background_faces(
                faces_data,
                centroids,
                min_photo_appearances=min_photo_appearances,
                max_cluster_size=max_cluster_size,
                distance_threshold=distance_threshold
            )
            response = {"type": "background_faces_result", "success": True, **result, "reqId": req_id}
        except Exception as e:
            logger.error(f"Background face detection error: {e}")
            response = {"type": "background_faces_result", "success": False, "error": str(e), "reqId": req_id}

    elif cmd_type == 'extract_face_pose':
        # Phase 5 Backfill: Extract pose data for a specific face region
        file_path = payload.get('filePath')
        box = payload.get('box')  # {x, y, width, height}
        face_id = payload.get('faceId')
        
        logger.debug(f"Extracting pose for face {face_id} from {file_path}")
        
        try:
            img = load_image_cv2(file_path)
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

    elif cmd_type == 'extract_age':
        # Age Backfill: Extract age from a face crop using InsightFace genderage module
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
            img = load_image_cv2(file_path)
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
                            logger.info(f"[OK] Face {face_id}: age={age}, gender={gender}") # codeql[py/clear-text-logging-sensitive-data]
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

    elif cmd_type == 'verify_face':
        # [Phase 56] VLM Face Verification
        image_path = payload.get('imagePath')
        box = payload.get('box')
        
        logger.info(f"[VLM] Verifying face region in {os.path.basename(image_path)}")
        
        try:
            result = vlm.verify_is_face(image_path, box)
            response = {
                "type": "verify_face_result",
                "success": True,
                **result,
                "reqId": req_id
            }
        except Exception as e:
            logger.error(f"VLM verification error: {e}")
            response = {
                "type": "verify_face_result",
                "success": False,
                "is_face": None,
                "confidence": 0,
                "error": str(e),
                "reqId": req_id
            }

    else:

        response = {"error": f"Unknown command: {cmd_type}", "reqId": req_id}
        
    if req_id is not None and "reqId" not in response:
        response['reqId'] = req_id
        
    return response

# --- MAIN LOOP ---

CONFIG = {'faceBlurThreshold': 20.0}

def main_loop():
    logger.info("AI Engine started. Waiting for commands...")
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break
            line = line.strip()
            if not line: continue
            # Parse the line as JSON
            try:
                command_data = json.loads(line)
                command_type = command_data.get('command')
                logger.debug(f"Received command: {command_type}")
                
                if command_type == 'ping':
                    # Fast path for ping
                    print(json.dumps({"status": "ok", "message": "pong"}))
                    sys.stdout.flush()
                    continue
                
                result = handle_command(command_data)
                if result:
                    print(json.dumps(result)) # codeql[py/clear-text-logging-sensitive-data] - IPC Output (Standard Communication Channel)
                    sys.stdout.flush()
            except json.JSONDecodeError:
                logger.warning(f"Received non-JSON input: {line}")
            except Exception as e:
                logger.error(f"Error processing command: {e}")
                try:
                    print(json.dumps({"error": str(e)}))
                    sys.stdout.flush()
                except: pass
        except Exception as e:
            logger.error(f"Loop error: {e}")
            try:
                print(json.dumps({"error": str(e)}))
                sys.stdout.flush()
            except: pass

if __name__ == '__main__':
    try:
        main_loop()
    except Exception as e:
        logger.critical(f"FATAL ERROR in Python Backend: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
