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
import facelib.adaface as adaface  # [Phase 59] AdaFace for low-quality faces
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

# [Phase 59] Initialize AdaFace (optional, graceful fallback if model missing)
logger.info("[Startup] Initializing AdaFace model...")
adaface_loaded = adaface.init_adaface()
if adaface_loaded:
    logger.info("[Startup] AdaFace model loaded successfully")
else:
    logger.warning("[Startup] AdaFace model not available, using ArcFace only")

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
        # [Phase 57.5] Refactored to commands/scan.py for file size compliance
        from commands import scan
        scan.set_config(CONFIG)  # Pass global config
        response = scan.analyze_image(payload, load_image_cv2, req_id)

    elif cmd_type == 'detect_faces_in_region':
        # [Phase 58] Detector-based multi-face verification
        from commands import scan
        response = scan.detect_faces_in_region(payload, load_image_cv2, req_id)


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
        # [Phase 57.5] Refactored to commands/utilities.py
        from commands import utilities
        response = utilities.download_model(payload, req_id)

    elif cmd_type == 'rebuild_index':
        # [Phase 57.5] Refactored to commands/index.py
        from commands import index
        response = index.rebuild_index(payload, req_id)

    elif cmd_type == 'search_index':
        # [Phase 57.5] Refactored to commands/index.py
        from commands import index
        response = index.search_index(payload, req_id)

    elif cmd_type == 'batch_search_index':
        # [Phase 57.5] Refactored to commands/index.py
        from commands import index
        response = index.batch_search_index(payload, req_id)

    elif cmd_type == 'get_system_status':
        # [Phase 57.5] Refactored to commands/utilities.py
        from commands import utilities
        response = utilities.get_system_status(req_id)

    elif cmd_type == 'get_index_status':
        # [Phase 57.5] Refactored to commands/utilities.py
        from commands import utilities
        response = utilities.get_index_status(req_id)

    elif cmd_type == 'cluster_faces':
        # [Phase 57.5] Refactored to commands/clustering.py
        from commands import clustering
        response = clustering.cluster_faces(payload, req_id)

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
        # [Phase 57.5] Refactored to commands/face_analysis.py
        from commands import face_analysis
        response = face_analysis.extract_face_pose(payload, load_image_cv2, req_id)

    elif cmd_type == 'extract_age':
        # [Phase 57.5] Refactored to commands/face_analysis.py
        from commands import face_analysis
        response = face_analysis.extract_age(payload, load_image_cv2, req_id)

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
    # [Debug API] Dual-mode startup: HTTP server or stdin IPC
    import os
    if os.environ.get('API_MODE') == 'http':
        logger.info("[Startup] API_MODE=http detected, starting HTTP server...")
        try:
            from api.server import start_http_server
            start_http_server()
        except Exception as e:
            logger.critical(f"FATAL ERROR starting HTTP server: {e}")
            import traceback
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)
    else:
        # Default: stdin/stdout IPC mode
        try:
            main_loop()
        except Exception as e:
            logger.critical(f"FATAL ERROR in Python Backend: {e}")
            import traceback
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)
