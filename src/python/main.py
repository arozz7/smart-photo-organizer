import sys
import json
import logging
import torch
import time
import os
import cv2
import numpy as np
import rawpy
import rawpy
import imageio


# Ensure CUDA DLLs are found if installed via pip
if os.name == 'nt':
    try:
        import nvidia.cudnn
        import nvidia.cublas
        
        try:
            cudnn_dir = os.path.dirname(nvidia.cudnn.__file__)
        except:
             cudnn_dir = list(nvidia.cudnn.__path__)[0]
             
        try:
             cublas_dir = os.path.dirname(nvidia.cublas.__file__)
        except:
             cublas_dir = list(nvidia.cublas.__path__)[0]
        
        for p in [cudnn_dir, os.path.join(cudnn_dir, 'bin'), cublas_dir, os.path.join(cublas_dir, 'bin')]:
             if os.path.exists(p):
                 try:
                     os.add_dll_directory(p)
                 except Exception:
                     pass
        os.environ['PATH'] = os.path.pathsep.join([cudnn_dir, os.path.join(cudnn_dir, 'bin')] + os.environ['PATH'].split(os.path.pathsep))
                     
    except ImportError:
        pass

    # Patch TensorRT DLLs
    try:
        import tensorrt_libs
        trt_libs_dir = list(tensorrt_libs.__path__)[0]
        if os.path.exists(trt_libs_dir):
            try:
                os.add_dll_directory(trt_libs_dir)
            except Exception:
                pass
            os.environ['PATH'] = trt_libs_dir + os.path.pathsep + os.environ['PATH']
    except ImportError:
        pass

from insightface.app import FaceAnalysis
import faiss
import pickle
import torch
from transformers import AutoProcessor, AutoModelForVision2Seq

# PATCH: Basicsr/Torchvision compatibility
# basicsr tries to import from 'torchvision.transforms.functional_tensor' which was removed in torchvision 0.18+
import torchvision
if hasattr(torchvision.transforms, 'functional_tensor'):
    pass # All good
else:
    try:
        import torchvision.transforms.functional as F
        import sys
        import types
        # Create a mock module
        mod = types.ModuleType("torchvision.transforms.functional_tensor")
        mod.rgb_to_grayscale = F.rgb_to_grayscale
        # Inject into sys.modules
        sys.modules["torchvision.transforms.functional_tensor"] = mod
        # Also inject into torchvision.transforms for good measure
        torchvision.transforms.functional_tensor = mod
    except ImportError:
        pass

import enhance # Local module

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger('ai_engine')

# --- GLOBALS ---
app = None # InsightFace
index = None # FAISS
id_map = {} # FAISS ID Map

# Configurable Paths
LIBRARY_PATH = os.environ.get('LIBRARY_PATH', '.')
index_file = os.path.join(LIBRARY_PATH, 'vectors.index')
id_map_file = os.path.join(LIBRARY_PATH, 'id_map.pkl')

# --- CONFIGURATION (Dynamic) ---
DET_THRESH = 0.6
BLUR_THRESH = 20.0
VLM_TEMP = 0.2
VLM_MAX_TOKENS = 100

vlm_processor = None # SmolVLM
vlm_model = None

# --- INITIALIZATION ---

def init_insightface():
    global app
    logger.info("Initializing InsightFace (Buffalo_L)...")
    try:
        from contextlib import redirect_stdout
        with redirect_stdout(sys.stderr):
             providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
             # Check if TensorRT is actually available to avoid spamming errors
             try:
                 import ctypes
                 # Try to find nvinfer_10.dll (standard for TRT 10.x)
                 # Since we added it to PATH/DLL_DIR above, this should succeed if correct
                 ctypes.CDLL('nvinfer_10.dll')
                 providers.insert(0, 'TensorrtExecutionProvider')
                 logger.info("TensorRT libraries found. enabling TensorrtExecutionProvider.")
             except Exception:
                 logger.info("TensorRT not found. Skipping TensorrtExecutionProvider.")
                 
             app = FaceAnalysis(name='buffalo_l', providers=providers)
             # Using dynamic threshold
             app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=DET_THRESH)
        logger.info("InsightFace initialized.")
    except Exception as e:
        logger.error(f"Failed to init InsightFace: {e}")
        raise e

# ... (init_faiss, save_faiss, init_vlm... no changes)

def smart_crop_landmarks(bbox, kps, img_width, img_height):
    """
    Uses 5 facial landmarks to center the crop and ensure adequate context.
    kps: 5x2 array [RightEye, LeftEye, Nose, RightMouth, LeftMouth]
    bbox: [x1, y1, x2, y2]
    """
    # 1. Calculate Face Center from landmarks
    # kps order in insightface (usually): [left_eye, right_eye, nose, left_mouth, right_mouth]
    # Check shape: kps is numpy array
    
    if kps is None or len(kps) == 0:
         # Fallback to simple box expansion if no landmarks
         return expand_box(bbox, img_width, img_height, 0.4)

    # Centroid of keypoints
    center_x = np.mean(kps[:, 0])
    center_y = np.mean(kps[:, 1])
    
    # 2. Determine Scale/Box Size
    # Use the bounding box size as a baseline
    x1, y1, x2, y2 = bbox
    raw_w = x2 - x1
    raw_h = y2 - y1
    raw_size = max(raw_w, raw_h)
    
    # Expansion Factor: 
    # Faces are approx 50-60% of the head height. 
    # We want to include hair (top) and neck (bottom).
    # 1.5x is a safer bet to avoid "huge" boxes while getting the hair.
    final_size = raw_size * 1.5
    half_size = final_size / 2
    
    # 3. Apply Offset
    # Center of landmarks is usually the nose/mid-face.
    # We want the distinct "Center" of the image to be slightly higher (eyes at 1/3 or 1/2 line).
    # Shift center_y up slightly (8% instead of 10% since box is smaller)
    center_y_shifted = center_y - (final_size * 0.08)
    
    # 4. Calculate coordinates
    new_x1 = center_x - half_size
    new_y1 = center_y_shifted - half_size
    new_x2 = center_x + half_size
    new_y2 = center_y_shifted + half_size
    
    # 5. Square enforcement? (Already square from half_size).
    # Just clamp.
    
    new_x1 = max(0, new_x1)
    new_y1 = max(0, new_y1)
    new_x2 = min(img_width, new_x2)
    new_y2 = min(img_height, new_y2)
    
    return [int(new_x1), int(new_y1), int(new_x2), int(new_y2)]

def expand_box(bbox, img_width, img_height, expansion_factor=0.25):
    """
    Fallback: Expands the bounding box by a factor to include more context.
    """
    x1, y1, x2, y2 = bbox
    w = x2 - x1
    h = y2 - y1
    
    pad_w = w * expansion_factor * 0.5
    pad_h = h * expansion_factor * 0.5
    
    new_x1 = max(0, x1 - pad_w)
    new_y1 = max(0, y1 - pad_h)
    new_x2 = min(img_width, x2 + pad_w)
    new_y2 = min(img_height, y2 + pad_h)
    
    return [int(new_x1), int(new_y1), int(new_x2), int(new_y2)]

# ... (ensure we match indentation for helper functions if any, but expand_box can be top level or helper)
# Actually, I'll place it before generate_captions or inside helpers section.
# Since I am replacing a block, I will just insert it effectively or ensure context is right.
# Wait, replacing a huge block is risky if I get lines wrong. 
# `scan_image` is inside `handle_command`. 
# calculated `det_size` change is in `init_insightface`.
# usage is in `handle_command`.
# I should probably split this into two edits if the blocks are far apart.
# init_insightface is around line 62.
# handle_command is around line 229.
# I will use multi_replace.


def init_faiss():
    global index, id_map
    logger.info("Initializing FAISS...")
    try:
        if os.path.exists(index_file):
            index = faiss.read_index(index_file)
            if os.path.exists(id_map_file):
                with open(id_map_file, 'rb') as f:
                    id_map = pickle.load(f)
            logger.info(f"Loaded existing index with {index.ntotal} vectors.")
        else:
            index = faiss.IndexFlatL2(512)
            logger.info("Created new FAISS index (512d).")
    except Exception as e:
        logger.error(f"Failed to init FAISS: {e}")
        index = faiss.IndexFlatL2(512)

def save_faiss():
    if index:
        faiss.write_index(index, index_file)
        with open(id_map_file, 'wb') as f:
            pickle.dump(id_map, f)

def init_vlm():
    global vlm_processor, vlm_model
    if vlm_model is not None:
        return

    logger.info("Initializing SmolVLM...")
    try:
        from contextlib import redirect_stdout
        with redirect_stdout(sys.stderr):
            vlm_processor = AutoProcessor.from_pretrained("HuggingFaceTB/SmolVLM-Instruct")
            try:
                from transformers import AutoModelForImageTextToText
                vlm_model = AutoModelForImageTextToText.from_pretrained(
                    "HuggingFaceTB/SmolVLM-Instruct",
                    torch_dtype=torch.float16, 
                    # device_map="cpu", 
                    _attn_implementation="eager" 
                )
            except ImportError:
                 # Fallback for older transformers
                 vlm_model = AutoModelForVision2Seq.from_pretrained(
                    "HuggingFaceTB/SmolVLM-Instruct",
                    torch_dtype=torch.float16,
                    # device_map="cpu",
                    _attn_implementation="eager"
                )
            
            # Manually move to CUDA to avoid Accelerate's dispatch overhead on Windows
            if torch.cuda.is_available():
               logger.info("Moving SmolVLM to CUDA...")
               vlm_model.to("cuda")
                
        logger.info("SmolVLM initialized.")
    except Exception as e:
        logger.error(f"Failed to init SmolVLM: {e}")
        vlm_model = None
        raise e

# --- HELPER FUNCTIONS ---

def expand_box(bbox, img_width, img_height, expansion_factor=0.4):
    """
    Expands the bounding box by a factor to include more context (hair, ears, chin).
    bbox: [x1, y1, x2, y2]
    """
    x1, y1, x2, y2 = bbox
    w = x2 - x1
    h = y2 - y1
    
    # Calculate padding
    pad_w = w * expansion_factor * 0.5
    pad_h = h * expansion_factor * 0.5
    
    # Apply padding and clamp to image boundaries
    new_x1 = max(0, x1 - pad_w)
    new_y1 = max(0, y1 - pad_h)
    new_x2 = min(img_width, x2 + pad_w)
    new_y2 = min(img_height, y2 + pad_h)
    
    return [int(new_x1), int(new_y1), int(new_x2), int(new_y2)]

def estimate_blur(image, target_size=None):
    """
    Estimates the blurriness of an image using the Variance of Laplacian method.
    Higher values = Sharper. Lower values = Blurry.
    """
    if image is None or image.size == 0: return 0.0
    
    if target_size:
        image = cv2.resize(image, (target_size, target_size))
        
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def generate_captions(image_path):
    if not vlm_model:
        init_vlm()
        
    logger.info(f"Generating tags for {image_path}...")

    # Robust Image Loading (Same as scan_image)
    from PIL import Image, ImageOps
    import numpy as np
    
    try:
        pil_img = Image.open(image_path)
        pil_img = ImageOps.exif_transpose(pil_img) # Handle EXIF
        # SmolVLM handles PIL images directly, but let's ensure it's RGB
        if pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')
    except Exception as e:
        # Fallback for RAW files (ARW, CR2, NEF)
        try:
            logger.info("PIL failed, attempting to read as RAW...")
            with rawpy.imread(image_path) as raw:
                rgb = raw.postprocess(user_flip=None) # Auto-rotate
                pil_img = Image.fromarray(rgb)
                
            logger.info("Successfully read RAW file.")
        except Exception as raw_e:
            logger.warning(f"PIL and RawPy read failed: {e} | {raw_e}")
            raise ValueError(f"Could not read image: {e} | {raw_e}")

    # No need for OpenCV conversion for VLM, it takes PIL
    # image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) 
    # pil_image = Image.fromarray(image)
    # We already have pil_img


    # Updated Prompt for Tagging
    prompt = "Analyze this image. Provide a detailed description. Then, provide 5-10 descriptive tags separated by commas. Start the list of tags with the word 'Tags:'."
    
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": prompt}
            ]
        }
    ]

    # Apply chat template
    text_prompt = vlm_processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    
    logger.info("Encoding inputs...")
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    inputs = vlm_processor(text=text_prompt, images=[pil_img], return_tensors="pt")
    inputs = inputs.to(vlm_model.device)
    
    logger.info("Running generation...")
    with torch.no_grad():
        generated_ids = vlm_model.generate(**inputs, max_new_tokens=VLM_MAX_TOKENS, temperature=VLM_TEMP, do_sample=(VLM_TEMP > 0))
    
    logger.info("Decoding output...")
    # Setup for slicing: get input length
    if hasattr(inputs, 'input_ids'):
         input_len = inputs.input_ids.shape[1]
    else:
         input_len = 0 # Fallback should not happen with generic inputs

    # Slice the generated_ids to only get new tokens
    new_ids = generated_ids[:, input_len:]
    generated_text = vlm_processor.batch_decode(new_ids, skip_special_tokens=True)
    full_text = generated_text[0].strip()
    
    # Parsing
    description = full_text
    tags = []
    
    # Try to extract Tags explicitly
    if "Tags:" in full_text:
        parts = full_text.split("Tags:")
        desc_part = parts[0].strip()
        tags_part = parts[1].strip()
        
        # Clean description
        if "Description:" in desc_part:
            description = desc_part.replace("Description:", "").strip()
        else:
            description = desc_part
            
        # Parse tags
        tags = [t.strip() for t in tags_part.split(",") if t.strip()]
        tags = [t.replace('[','').replace(']','').replace('.','') for t in tags] # Clean punctuation
    else:
        # Fallback: Extract keywords from description
        logger.info("Tags not found explicitly, extracting from description...")
        import re
        # Simple stopword list
        stopwords = {'a', 'an', 'the', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 
                     'and', 'or', 'but', 'of', 'to', 'with', 'for', 'this', 'that', 
                     'there', 'it', 'he', 'she', 'they', 'looking', 'standing', 'holding'}
        
        words = re.findall(r'\b\w+\b', description.lower())
        keywords = [w for w in words if w not in stopwords and len(w) > 3]
        # Deduplicate preserving order
        seen = set()
        tags = []
        for w in keywords:
            if w not in seen:
                seen.add(w)
                tags.append(w)
        tags = tags[:8] # Take top 8 keywords

        tags = tags[:8] # Take top 8 keywords

    return description, tags

def calculate_mean_embedding(descriptors):
    """
    Calculates the mean embedding from a list of descriptors.
    descriptors: List of 512-d lists or numpy arrays.
    Returns: 512-d list (mean vector).
    """
    if not descriptors:
        return []
    
    # Convert to numpy array for easy mean calc
    arr = np.array(descriptors)
    mean_vec = np.mean(arr, axis=0)
    
    # Normalize? InsightFace descriptors are usually normalized. 
    # Averaging might reduce length. Re-normalization is often good for cosine similarity.
    norm = np.linalg.norm(mean_vec)
    if norm > 0:
        mean_vec = mean_vec / norm
        
    return mean_vec.tolist()

def cluster_faces_dbscan(descriptors, ids, eps=0.5, min_samples=2):
    """
    Clusters faces using DBSCAN.
    descriptors: List of embedding vectors.
    ids: List of corresponding face/photo IDs to return in clusters.
    Returns: List of clusters, where each cluster is a list of ids.
    """
    if not descriptors:
        return []

    X = np.array(descriptors)
    
    # 1. Normalize Vectors (Critical for Cosine/Euclidean equivalence)
    # If vectors are not normalized, Euclidean distance will be huge.
    # L2 Normalization:
    norm = np.linalg.norm(X, axis=1, keepdims=True)
    # Avoid division by zero
    norm[norm == 0] = 1e-10
    X = X / norm

    try:
        from sklearn.cluster import DBSCAN
    except ImportError:
        return [] 

    # DBSCAN with parameters tuned for ArcFace (Normalized Euclidean)
    # metric='euclidean' on normalized vectors approximates cosine distance.
    # dist = sqrt(2(1-cos)).
    # eps=0.6 -> cos_dist approx 0.18 (Strict)
    # eps=0.75 -> cos_dist approx 0.28 (Medium)
    # eps=0.85 -> cos_dist approx 0.36 (Loose)
    # Smart Naming uses cos_dist 0.4. We choose 0.75 to be safe but inclusive.
    clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='euclidean').fit(X)
    
    labels = clustering.labels_
    
    clusters = {}
    for idx, label in enumerate(labels):
        if label == -1: continue # Noise
        if label not in clusters: clusters[label] = []
        clusters[label].append(ids[idx])
        
    return list(clusters.values())

# --- COMMAND HANDLER ---

def handle_command(command):
    cmd_type = command.get('type')
    payload = command.get('payload', {})
    req_id = payload.get('reqId')
    
    logger.info(f"Received command: {cmd_type}")

    response = {}
    if req_id:
         response['reqId'] = req_id

    if cmd_type == 'ping':
        response = {"type": "pong", "timestamp": time.time()}

    elif cmd_type == 'update_config':
        global DET_THRESH, BLUR_THRESH, VLM_TEMP, VLM_MAX_TOKENS
        config = payload.get('config', {})
        logger.info(f"Updating Config: {config}")
        
        if 'faceDetectionThreshold' in config:
            DET_THRESH = float(config['faceDetectionThreshold'])
            # Re-prepare app if needed, or just rely on it for next init if we were lazy.
            # But InsightFace app.prepare sets internal state. We might need to re-prepare.
            if app:
                app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=DET_THRESH)

        if 'faceBlurThreshold' in config:
            BLUR_THRESH = float(config['faceBlurThreshold'])
            
        if 'vlmTemperature' in config:
            VLM_TEMP = float(config['vlmTemperature'])
            
        if 'vlmMaxTokens' in config:
            VLM_MAX_TOKENS = int(config['vlmMaxTokens'])

        response = {"type": "config_updated"}


    elif cmd_type == 'scan_image':
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        preview_dir = payload.get('previewStorageDir')
        
        logger.info(f"Scanning image {photo_id} at {file_path}...")
        
        # Debug passed via payload if needed
        # payload['debug'] = True 
        
        try:
            # Handle EXIF Orientation using Pillow
            # cv2.imread ignores EXIF rotation, causing bounding box mismatches
            from PIL import Image, ImageOps
            
            try:
                pil_img = Image.open(file_path)
                pil_img = ImageOps.exif_transpose(pil_img) # Auto-rotate based on EXIF
                # Convert PIL (RGB) to OpenCV (BGR)
                rgb_img = np.array(pil_img)
                img = cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)
                logger.info("Image loaded via PIL (EXIF handled).")
            except Exception as e:
                logger.warning(f"PIL/Exif read failed: {e}")
                # Try RawPy
                try:
                    logger.info("Attempting RAW read...")
                    with rawpy.imread(file_path) as raw:
                        # user_flip=None allows rawpy to automatically rotate based on metadata associated with RAW
                        # but sometimes it fails. If PIL failed, this is our best bet.
                        rgb = raw.postprocess(use_camera_wb=True) 
                        # rawpy returns RGB. Convert to BGR for OpenCV
                        img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
                    logger.info("Image loaded via RawPy.")
                except Exception as raw_e:
                    logger.warning(f"RawPy failed: {raw_e}")
                    # Final fallback to standard CV2 (unlikely to work if PIL failed, but safe)
                    img = cv2.imread(file_path)

            if img is None:
                 logger.error(f"Could not read image: {file_path}")
                 return {"error": "Could not read image"}
                 
            # Generate Preview if needed (e.g. for TIFF support)
            preview_path = None
            if preview_dir:
                 try:
                     preview_filename = f"preview_{photo_id}.jpg"
                     preview_path = os.path.join(preview_dir, preview_filename)
                     
                     # Only generate if not exists or overwrite? Let's overwrite to be safe/fresh.
                     # Resize for performance (max 1280px)
                     h, w = img.shape[:2]
                     max_dim = 1280
                     if h > max_dim or w > max_dim:
                         scale = max_dim / max(h, w)
                         new_w, new_h = int(w * scale), int(h * scale)
                         preview_img = cv2.resize(img, (new_w, new_h))
                     else:
                         preview_img = img
                         
                     # Ensure we save with valid extension
                     cv2.imwrite(preview_path, preview_img)
                     # logger.info(f"Generated preview: {preview_path}")
                 except Exception as ex:
                     logger.error(f"Failed to generate preview: {ex}")
                     preview_path = None



            # InsightFace expects BGR (cv2 default) 
            # but let's double check if FaceAnalysis handles it. Yes, it uses cv2 internally.
            
            faces = app.get(img)
            
            img_height, img_width = img.shape[:2]
            logger.info(f"Image Dimensions: {img_width}x{img_height}")
            
            # Global Blur Score (Resize to max 2048 for speed/consistency)
            global_blur_score = 0.0
            try:
                max_dim = 2048
                h, w = img.shape[:2]
                scale = 1.0
                if h > max_dim or w > max_dim:
                    scale = max_dim / max(h, w)
                    new_w, new_h = int(w * scale), int(h * scale)
                    resized_for_blur = cv2.resize(img, (new_w, new_h))
                    global_blur_score = estimate_blur(resized_for_blur)
                else:
                    global_blur_score = estimate_blur(img)
                logger.info(f"Global Blur Score: {global_blur_score:.2f}")
            except Exception as e:
                logger.error(f"Failed to calc global blur: {e}")

            results = []
            for face in faces:
                # face.bbox is [x1, y1, x2, y2]
                bbox = face.bbox.astype(int).tolist()
                kps = face.kps if hasattr(face, 'kps') else None
                
                # Use Smart Crop with Landmarks if available
                # Logic is inside smart_crop_landmarks, let's log input there if needed, 
                # but better to rely on the Output Image to see what happened.
                expanded_bbox = smart_crop_landmarks(bbox, kps, img_width, img_height)
                
                x, y, x2, y2 = expanded_bbox
                w = x2 - x
                h = y2 - y
                
                # face.embedding is numpy array
                embedding = face.embedding.tolist()

                # Calculate Blur Score
                # Use the original bbox crop for blur estimation (tighter is better for face clarity)
                bx1, by1, bx2, by2 = bbox
                # Clamp
                bx1, by1 = max(0, bx1), max(0, by1)
                bx2, by2 = min(img_width, bx2), min(img_height, by2)
                face_crop = img[by1:by2, bx1:bx2]
                blur_score = estimate_blur(face_crop, target_size=112)
                
                # Filter out extremely blurry faces (Prevention)
                if blur_score < BLUR_THRESH:
                    logger.info(f"Skipping face with low blur score: {blur_score:.2f} < {BLUR_THRESH}")
                    # Optionally we could still return it but mark it as ignored?
                    # The requirement says "not capture". So we skip adding to results.
                    # check if it is REALLY garbage. 
                    # If we skip here, it never enters the DB.
                    continue

                results.append({
                    "box": {"x": x, "y": y, "width": w, "height": h},
                    "descriptor": embedding,
                    "score": float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                    "blurScore": float(blur_score)
                })
                
            logger.info(f"Found {len(results)} faces.")
            
            # Debug Visualization
            if payload.get('debug'):
                try:
                    debug_img = img.copy()
                    for res in results:
                        box = res['box']
                        x, y, w, h = box['x'], box['y'], box['width'], box['height']
                        # Draw Smart Crop Box (Cyan)
                        cv2.rectangle(debug_img, (x, y), (x+w, y+h), (255, 255, 0), 2)
                        
                    # Also draw raw detection boxes/landmarks if we still have the face objects
                    for face in faces:
                        bbox = face.bbox.astype(int)
                        # Draw Raw Detection Box (Red - Thinner)
                        cv2.rectangle(debug_img, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 0, 255), 1)
                        if hasattr(face, 'kps') and face.kps is not None:
                            for kp in face.kps:
                                cv2.circle(debug_img, (int(kp[0]), int(kp[1])), 2, (0, 255, 0), -1)

                    output_path = payload.get('debugOutputPath', 'scan_debug.jpg')
                    cv2.imwrite(output_path, debug_img)
                    logger.info(f"Saved debug visualization to {os.path.abspath(output_path)}")
                except Exception as e:
                    logger.error(f"Failed to save debug image: {e}")

            response = {
                "type": "scan_result",
                "photoId": photo_id,
                "faces": results,
                "previewPath": preview_path,
                "width": img_width,
                "height": img_height,
                "globalBlurScore": float(global_blur_score)
            }
            
        except Exception as e:
            logger.exception("Face Scan Error")
            response = {"error": str(e)}

    elif cmd_type == 'generate_tags':
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        logger.info(f"Generating tags for {photo_id}...")
        try:
             description, tags = generate_captions(file_path)
             response = {
                 "type": "tags_result",
                 "photoId": photo_id,
                 "description": description,
                 "tags": tags
             }
        except Exception as e:
            logger.exception("VLM Error")
            # Return error so we can log it in DB
            response = {
                "type": "tags_result",
                "photoId": photo_id, 
                "error": str(e)
            }

    elif cmd_type == 'cluster_faces':
        photo_id = payload.get('photoId')
        descriptors = payload.get('descriptors', [])
        ids = payload.get('ids', [])
        eps = payload.get('eps', 0.75)
        min_samples = payload.get('min_samples', 2)
        
        logger.info(f"Clustering {len(descriptors)} faces... (ReqID: {photo_id})")
        try:
            clusters = cluster_faces_dbscan(descriptors, ids, eps, min_samples)
            logger.info(f"Found {len(clusters)} clusters.")
            response = {
                "type": "cluster_result",
                "photoId": photo_id,
                "clusters": clusters
            }
        except Exception as e:
            logger.exception("Clustering Error")
            response = {"error": str(e)}

    elif cmd_type == 'get_mean_embedding':
        descriptors = payload.get('descriptors', [])
        try:
            mean_vector = calculate_mean_embedding(descriptors)
            response = {
                "type": "mean_embedding_result",
                "embedding": mean_vector
            }
        except Exception as e:
            response = {"error": str(e)}

    elif cmd_type == 'enhance_image':
        file_path = payload.get('filePath')
        out_path = payload.get('outPath')
        task = payload.get('task', 'upscale') # upscale | restore_faces
        model_name = payload.get('modelName', 'RealESRGAN_x4plus')
        face_enhance = payload.get('faceEnhance', False) # New flag
        
        logger.info(f"Enhancing image: {file_path} -> {out_path} [{task}/{model_name}] (FaceEnhance: {face_enhance})")
        try:
            # Check if model exists first? enhance.py handles it
            result_path = enhance.enhancer.enhance(file_path, out_path, task, model_name, face_enhance)
            response = {
                "type": "enhance_result",
                "success": True,
                "outPath": result_path,
                "reqId": req_id
            }
        except Exception as e:
            logger.exception("Enhancement Error")
            response = {
                "type": "enhance_result",
                "success": False,
                "error": str(e),
                "reqId": req_id
            }

    elif cmd_type == 'download_model':
        model_name = payload.get('modelName')
        logger.info(f"Downloading model: {model_name}")
        try:
            path = enhance.enhancer._download_model(model_name)
            response = {
                "type": "download_model_result",
                "success": True,
                "path": path
            }
        except Exception as e:
            logger.exception("Download Error")
            response = {
                "type": "download_model_result",
                "success": False,
                "error": str(e)
            }

    elif cmd_type == 'rebuild_index':
        descriptors = payload.get('descriptors', [])
        ids = payload.get('ids', [])
        logger.info(f"Rebuilding FAISS index with {len(descriptors)} vectors...")
        try:
            # Reset index and id_map
            global index, id_map
            index = faiss.IndexFlatL2(512)
            id_map = {}
            
            if descriptors:
                X = np.array(descriptors).astype('float32')
                # FAISS prefers normalized vectors for L2 to act like Cosine similarity
                faiss.normalize_L2(X)
                index.add(X)
                
                for i, face_id in enumerate(ids):
                    id_map[i] = face_id
                
            save_faiss()
            response = {
                "type": "rebuild_index_result",
                "count": index.ntotal,
                "success": True,
                "reqId": req_id
            }
        except Exception as e:
            logger.exception("Index rebuild failed")
            response = {"error": str(e), "reqId": req_id}

    elif cmd_type == 'search_index':
        descriptor = payload.get('descriptor')
        k = payload.get('k', 10)
        threshold = payload.get('threshold', 0.6) # L2 distance threshold
        
        if not descriptor or index is None or index.ntotal == 0:
            response = {"type": "search_result", "matches": [], "reqId": req_id}
        else:
            try:
                X = np.array([descriptor]).astype('float32')
                faiss.normalize_L2(X)
                
                distances, indices = index.search(X, k)
                
                matches = []
                for dist, idx in zip(distances[0], indices[0]):
                    if idx == -1: continue
                    if dist > threshold: continue # In L2 on normalized vectors, smaller = closer
                    
                    face_id = id_map.get(int(idx))
                    if face_id is not None:
                        matches.append({
                            "id": face_id,
                            "distance": float(dist)
                        })
                
                response = {
                    "type": "search_result",
                    "matches": matches,
                    "reqId": req_id
                }
            except Exception as e:
                logger.exception("Search failed")
                response = {"error": str(e), "reqId": req_id}

    elif cmd_type == 'get_system_status':
        status = {}
        try:
            # 1. InsightFace Status
            insightface_status = {'loaded': False}
            if app:
                providers = []
                try:
                    # Attempt to get providers from the detection model (usually active)
                    if hasattr(app, 'models') and 'detection' in app.models:
                        det_model = app.models['detection']
                        if hasattr(det_model, 'session'):
                            providers = det_model.session.get_providers()
                        elif hasattr(det_model, 'net') and hasattr(det_model.net, 'session'):
                            providers = det_model.net.session.get_providers()
                except Exception:
                    providers = ["Unknown"]

                insightface_status = {
                    'loaded': True,
                    'providers': providers,
                    'det_thresh': DET_THRESH,
                    'blur_thresh': BLUR_THRESH
                }
            status['insightface'] = insightface_status

            # 2. FAISS Status
            faiss_status = {'loaded': False}
            if index:
                 faiss_status = {
                     'loaded': True,
                     'count': index.ntotal,
                     'dim': index.d
                 }
            status['faiss'] = faiss_status

            # 3. VLM Status
            vlm_status = {
                'loaded': vlm_model is not None,
                'device': str(vlm_model.device) if vlm_model else 'N/A',
                'model': 'SmolVLM',
                'config': {
                    'temp': VLM_TEMP,
                    'max_tokens': VLM_MAX_TOKENS
                }
            }
            status['vlm'] = vlm_status

            # 4. Libraries & System
            import onnxruntime
            status['system'] = {
                'python': sys.version.split()[0],
                'torch': torch.__version__,
                'cuda_available': torch.cuda.is_available(),
                'cuda_device': torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None',
                'onnxruntime': onnxruntime.__version__,
                'opencv': cv2.__version__
            }

            response = {
                "type": "system_status_result",
                "status": status
            }
        except Exception as e:
            logger.error(f"Error getting status: {e}")
            response = {"error": str(e)}
    else:
        response = {"error": f"Unknown command: {cmd_type}"}
        
    # Inject request ID if present so Electron can map the promise
    if req_id is not None:
        response['reqId'] = req_id
        
    return response

# --- MAIN LOOP ---

def main():
    try:
        init_insightface()
        init_faiss()
        # init_vlm() # Lazy load to save startup time? Or eager?
        # Let's eager load if it's fast enough, but it's big. Keep lazy for now.
    except Exception:
        logger.critical("Model initialization failed. Exiting.")
        sys.exit(1)

    logger.info("AI Engine started. Waiting for commands...")
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break
            line = line.strip()
            if not line: continue
            
            try:
                command = json.loads(line)
                response = handle_command(command)
                print(json.dumps(response))
                sys.stdout.flush()
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON: {e}")
                print(json.dumps({"error": "Invalid JSON"}))
                sys.stdout.flush()
        except Exception as e:
            logger.exception("Critical loop error")
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
