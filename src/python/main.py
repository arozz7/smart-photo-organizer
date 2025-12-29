import sys
import json
import logging
import time
import os
import cv2
import numpy as np
import rawpy
import imageio
import pickle
import re
import types
from sklearn.cluster import DBSCAN
import requests

# --- RUNTIME LOADING ---
# If an external AI runtime (torch, cuda, etc) is downloaded, we inject it into the path
LIBRARY_PATH = os.environ.get('LIBRARY_PATH', os.path.expanduser('~/.smart-photo-organizer'))
AI_RUNTIME_PATH = os.path.join(LIBRARY_PATH, 'ai-runtime')

# --- RUNTIME LOADING ---
# If an external AI runtime (torch, cuda, etc) is downloaded, we inject it into the path
LIBRARY_PATH = os.environ.get('LIBRARY_PATH', os.path.expanduser('~/.smart-photo-organizer'))
AI_RUNTIME_PATH = os.path.join(LIBRARY_PATH, 'ai-runtime')

def inject_runtime():
    """
    Scans for the AI Runtime and injects it into sys.path.
    Returns True if injected, False otherwise.
    """
    if os.environ.get('IS_DEV') == 'true':
        print("[AI_INIT] Dev Mode detected. Skipping AI Runtime injection.", file=sys.stderr)
        return False

    print(f"[AI_INIT] Checking for AI Runtime at: {AI_RUNTIME_PATH}", file=sys.stderr)
    
    if os.path.exists(AI_RUNTIME_PATH):
        # Search for site-packages (handle potential nesting from zip extraction)
        found_site_packages = None
        found_bin = None
        
        # Strat 1: Check standard location
        possible_site = os.path.join(AI_RUNTIME_PATH, 'lib', 'site-packages')
        if os.path.exists(possible_site):
            found_site_packages = possible_site
            found_bin = os.path.join(AI_RUNTIME_PATH, 'bin')
        else:
            # Strat 2: Search subdirectories (max depth 2)
            print("[AI_INIT] Runtime not found in root, searching subdirectories...", file=sys.stderr)
            for root, dirs, files in os.walk(AI_RUNTIME_PATH):
                 if 'site-packages' in dirs:
                     found_site_packages = os.path.join(root, 'site-packages')
                     parent = os.path.dirname(root) 
                     found_bin = os.path.join(parent, 'bin')
                     break
                 
                 # Limit depth
                 current_depth = root[len(AI_RUNTIME_PATH):].count(os.sep)
                 if current_depth > 2:
                     del dirs[:]

        if found_site_packages:
            if found_site_packages not in sys.path:
                print(f"[AI_INIT] Injecting runtime libraries from: {found_site_packages}", file=sys.stderr)
                sys.path.insert(0, found_site_packages)
            else:
                print(f"[AI_INIT] Runtime already in path: {found_site_packages}", file=sys.stderr)
            
            # --- DEBUG: CHECK MODULES ---
            try:
                # LIST SITE-PACKAGES
                # print(f"[AI_INIT] site-packages contents: {os.listdir(found_site_packages)}", file=sys.stderr)
                
                # CHECK TORCHGEN
                tgen_path = os.path.join(found_site_packages, 'torchgen')
                if os.path.exists(tgen_path):
                     print(f"[AI_INIT] torchgen folder found at {tgen_path}", file=sys.stderr)
                     if os.path.exists(os.path.join(tgen_path, '__init__.py')):
                         print("[AI_INIT] torchgen/__init__.py exists", file=sys.stderr)
                     else:
                         print("[AI_INIT] ERROR: torchgen/__init__.py MISSING!", file=sys.stderr)
                else:
                     print("[AI_INIT] ERROR: torchgen folder NOT found!", file=sys.stderr)

                # ATTEMPT EXPLICIT IMPORT
                print("[AI_INIT] Attempting explicit 'import torchgen'...", file=sys.stderr)
                import torchgen
                print(f"[AI_INIT] 'import torchgen' SUCCESS. Path: {torchgen.__file__}", file=sys.stderr)
                
                print("[AI_INIT] Attempting explicit 'import yaml'...", file=sys.stderr)
                import yaml
                print(f"[AI_INIT] 'import yaml' SUCCESS. Path: {yaml.__file__}", file=sys.stderr)
                
            except ImportError as ie:
                print(f"[AI_INIT] Explicit import failed: {ie}", file=sys.stderr)
            except Exception as e:
                print(f"[AI_INIT] Debug check failed: {e}", file=sys.stderr)
            # ----------------------------

            # INSPECT TORCH VERSION
            try:
                torch_dir = os.path.join(found_site_packages, 'torch')
                if os.path.exists(torch_dir):
                    pyd_files = [f for f in os.listdir(torch_dir) if f.endswith('.pyd')]
                    print(f"[AI_INIT] Found torch .pyd files: {pyd_files}", file=sys.stderr)
                    
                    # Check for torch/lib
                    torch_lib_dir = os.path.join(torch_dir, 'lib')
                    if os.path.exists(torch_lib_dir):
                         dlls = [f for f in os.listdir(torch_lib_dir) if f.endswith('.dll')]
                         print(f"[AI_INIT] Found torch/lib DLLs: {len(dlls)} files", file=sys.stderr)
                         # Add torch/lib to DLL search path explicitly (just in case)
                         if os.name == 'nt':
                             try:
                                 os.add_dll_directory(torch_lib_dir)
                                 print(f"[AI_INIT] Added torch/lib to DLL directory", file=sys.stderr)
                             except: pass
                else:
                    print(f"[AI_INIT] Warning: 'torch' directory not found in {found_site_packages}", file=sys.stderr)
            except Exception as e:
                 print(f"[AI_INIT] Error inspecting torch: {e}", file=sys.stderr)

            # Also add DLL directory for CUDA
            if os.name == 'nt' and found_bin and os.path.exists(found_bin):
                try:
                    os.add_dll_directory(found_bin)
                    print(f"[AI_INIT] Added DLL directory: {found_bin}", file=sys.stderr)
                except Exception as e:
                    print(f"[AI_INIT] Failed to add DLL directory: {e}", file=sys.stderr)
                    
            return True
        else:
            print(f"[AI_INIT] AI Runtime folder exists at {AI_RUNTIME_PATH} but 'site-packages' could not be found.", file=sys.stderr)
            try:
                 print(f"[AI_INIT] Directory listing: {os.listdir(AI_RUNTIME_PATH)}", file=sys.stderr)
            except: pass
    else:
        print("[AI_INIT] AI Runtime folder not found. Using system environment or fallback.", file=sys.stderr)
    
    return False

# Initial Check
inject_runtime()


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

# --- LAZY IMPORTS ---
def get_torch():
    try:
        import torch
        return torch
    except ImportError as e:
        print(f"[AI_INIT] Failed to import torch: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[AI_INIT] Unexpected error importing torch: {e}", file=sys.stderr)
        return None

def get_transformers():
    try:
        from transformers import AutoProcessor, AutoModelForVision2Seq
        return AutoProcessor, AutoModelForVision2Seq
    except ImportError:
        return None, None

def get_faiss():
    try:
        import faiss
        return faiss
    except ImportError:
        return None

# Initial cleanup of global scope to avoid early import failures
torch_lib = get_torch()
faiss_lib = get_faiss()

if torch_lib:
    # PATCH: Basicsr/Torchvision compatibility
    import torchvision
    if not hasattr(torchvision.transforms, 'functional_tensor'):
        try:
            import torchvision.transforms.functional as F
            import types
            mod = types.ModuleType("torchvision.transforms.functional_tensor")
            mod.rgb_to_grayscale = F.rgb_to_grayscale
            sys.modules["torchvision.transforms.functional_tensor"] = mod
            torchvision.transforms.functional_tensor = mod
        except ImportError:
            pass

    # AUTO-DETECT MODE
    if torch_lib.cuda.is_available():
        AI_MODE = "GPU"
        print("[AI_INIT] Torch detected CUDA. Setting initial mode to GPU.", file=sys.stderr)
    else:
        AI_MODE = "CPU"
        print("[AI_INIT] Torch did not detect CUDA. Setting initial mode to CPU.", file=sys.stderr)
else:
    AI_MODE = "SAFE_MODE"
    print("[AI_INIT] Torch not loaded. Setting initial mode to SAFE_MODE.", file=sys.stderr)

import enhance # Local module

# Configure logging
LOG_PATH = os.environ.get('LOG_PATH')
handlers = [logging.StreamHandler(sys.stderr)]

if LOG_PATH:
    if not os.path.exists(LOG_PATH):
        os.makedirs(LOG_PATH, exist_ok=True)
    from logging.handlers import RotatingFileHandler
    handlers.append(RotatingFileHandler(
        os.path.join(LOG_PATH, 'python.log'),
        maxBytes=5*1024*1024, # 5MB
        backupCount=1
    ))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=handlers
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
DET_THRESH = 0.5
BLUR_THRESH = 20.0
VLM_TEMP = 0.2
VLM_MAX_TOKENS = 100

vlm_processor = None # SmolVLM
vlm_model = None

# AI STATUS TRACKING
# AI_MODE initialized above
CURRENT_PROVIDERS = None
ALLOWED_MODULES = None
VLM_ENABLED = False

# --- INITIALIZATION ---

def init_insightface(providers=None, ctx_id=0, allowed_modules=None, det_size=(1280, 1280), det_thresh=None):
    global app, AI_MODE, CURRENT_PROVIDERS, ALLOWED_MODULES
    
    if det_thresh is None:
        det_thresh = DET_THRESH
    
    # OPTIMIZATION: Default to only essential modules to prevent GPU crashes in auxiliary models (3d landmarks)
    if allowed_modules is None:
        allowed_modules = ['detection', 'recognition']

    logger.info(f"Initializing InsightFace with ctx_id={ctx_id}, modules={allowed_modules}, det_size={det_size}...")
    
    # [OPTIMIZATION] Avoid re-initializing if already loaded with same config (simplified check)
    if app is not None:
        # Check if we just need to update preparation parameters (ctx_id, det_size)
        # Note: FaceAnalysis.prepare changes internal models. If providers/modules are same, we can re-prepare or just reuse.
        # For simplicity and speed: if app exists, assume providers/modules are static for this session.
        # But we MUST re-prepare if det_size changes (e.g. switching from Fast to High Accuracy)
        try:
             app.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
             return
        except Exception as e:
             logger.warning(f"Failed to re-prepare existing app (will re-init): {e}")

    try:
        from contextlib import redirect_stdout
        from insightface.app import FaceAnalysis
        with redirect_stdout(sys.stderr):
             if providers is None:
                 # Auto-detect logic
                 providers = []
                 # Check for CUDA
                 if torch_lib and torch_lib.cuda.is_available():
                     logger.info("CUDA detected via Torch. Preferring CUDAExecutionProvider.")
                     providers.append('CUDAExecutionProvider')
                 
                 # Check for TensorRT
                 try:
                     import ctypes
                     ctypes.CDLL('nvinfer_10.dll')
                     logger.info("TensorRT libraries found. enabling TensorrtExecutionProvider.")
                     providers.insert(0, 'TensorrtExecutionProvider')
                 except Exception:
                     pass
                 
                 providers.append('CPUExecutionProvider')

             logger.info(f"Initializing FaceAnalysis with Providers: {providers}")
             app = FaceAnalysis(name='buffalo_l', providers=providers, allowed_modules=allowed_modules)
             
             # Prepare
             # If det_size is not provided, use default
             # Note: det_size=(640, 640) is standard. (-1) might go too big.
             app.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
             
             # Update Status Globals
             CURRENT_PROVIDERS = providers
             ALLOWED_MODULES = allowed_modules
             
             # Determine Mode String
             if 'CUDAExecutionProvider' in providers and ctx_id >= 0:
                 AI_MODE = "GPU"
             elif allowed_modules is not None:
                 AI_MODE = "SAFE_MODE"
             else:
                 AI_MODE = "CPU"
                 
        logger.info(f"InsightFace initialized. Mode: {AI_MODE}")
    except Exception as e:
        logger.error(f"Failed to init InsightFace: {e}")
        raise e
        logger.info("InsightFace initialized.")
    except Exception as e:
        logger.error(f"Failed to init InsightFace: {e}")
        raise e


# --- HELPER FUNCTIONS ---

def smart_crop_landmarks(bbox, kps, img_width, img_height):
    """
    Uses 5 facial landmarks to center the crop and ensure adequate context.
    kps: 5x2 array [RightEye, LeftEye, Nose, RightMouth, LeftMouth]
    bbox: [x1, y1, x2, y2]
    """
    if kps is None or len(kps) == 0:
         return expand_box(bbox, img_width, img_height, 0.4)
    
    # Calculate crop center and size
    eye_center = np.mean(kps[:2], axis=0)
    mouth_center = np.mean(kps[3:], axis=0)
    face_center = (eye_center + mouth_center) / 2
    
    # Heuristic for face size based on landmarks
    face_size = np.linalg.norm(eye_center - mouth_center) * 2.5
    final_size = face_size * 1.5
    
    half_size = final_size / 2
    center_x, center_y = face_center
    
    # Shift center_y up slightly
    center_y_shifted = center_y - (final_size * 0.08)
    
    new_x1 = max(0, center_x - half_size)
    new_y1 = max(0, center_y_shifted - half_size)
    new_x2 = min(img_width, center_x + half_size)
    new_y2 = min(img_height, center_y_shifted + half_size)
    
    return [int(new_x1), int(new_y1), int(new_x2), int(new_y2)]


def init_faiss():
    global index, id_map
    logger.info("Initializing FAISS...")
    if not faiss_lib:
        logger.warning("FAISS library not loaded. Vector search will be disabled.")
        return

    try:
        if os.path.exists(index_file):
            index = faiss_lib.read_index(index_file)
            if os.path.exists(id_map_file):
                with open(id_map_file, 'rb') as f:
                    id_map = pickle.load(f)
            logger.info(f"Loaded existing index with {index.ntotal} vectors.")
        else:
            index = faiss_lib.IndexFlatL2(512)
            logger.info("Created new FAISS index (512d).")
    except Exception as e:
        logger.error(f"Failed to init FAISS: {e}")
        index = faiss_lib.IndexFlatL2(512)

def save_faiss():
    if index and faiss_lib:
        faiss_lib.write_index(index, index_file)
        with open(id_map_file, 'wb') as f:
            pickle.dump(id_map, f)

def init_vlm():
    global vlm_processor, vlm_model
    if vlm_model is not None:
        return

    logger.info("Initializing SmolVLM...")
    try:
        import torch
    except ImportError:
        logger.warning("Torch not found. VLM (Smart Tagging) will be disabled.")
        vlm_model = None
        global VLM_ENABLED
        VLM_ENABLED = False
        return

    try:
        # Select device/dtype
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        logger.info(f"VLM using device: {device}, dtype: {dtype}")

        from contextlib import redirect_stdout
        from transformers import AutoProcessor
        with redirect_stdout(sys.stderr):
            vlm_processor = AutoProcessor.from_pretrained("HuggingFaceTB/SmolVLM-Instruct")
            try:
                from transformers import AutoModelForImageTextToText
                vlm_model = AutoModelForImageTextToText.from_pretrained(
                    "HuggingFaceTB/SmolVLM-Instruct",
                    torch_dtype=dtype, 
                    _attn_implementation="eager" 
                )
            except ImportError:
                 # Fallback for older transformers
                 vlm_model = AutoModelForVision2Seq.from_pretrained(
                    "HuggingFaceTB/SmolVLM-Instruct",
                    torch_dtype=dtype,
                    _attn_implementation="eager"
                )
            
            if device == "cuda":
               logger.info("Moving SmolVLM to CUDA...")
               vlm_model.to("cuda")
                
        logger.info("SmolVLM initialized.")
    except Exception as e:
        logger.error(f"Failed to init SmolVLM: {e}")
        vlm_model = None
        # Don't raise, just disable VLM



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

def estimate_sharpness_tenengrad(image, target_size=None):
    """
    Estimates sharpness using the Tenengrad (Sobel gradient magnitude) method.
    Robust to noise and background blur. Returns mean squared magnitude.
    """
    if image is None or image.size == 0: return 0.0

    if target_size:
        h, w = image.shape[:2]
        if h > target_size or w > target_size:
            scale = target_size / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            image = cv2.resize(image, (new_w, new_h))

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Sobel Gradients
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    
    # Gradient Magnitude
    mag = cv2.magnitude(gx, gy)
    
    # Mean of squares (energy)
    return np.mean(mag * mag)


def generate_captions(image_path):
    if not vlm_model:
        init_vlm()
        
    import torch
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
        raw_tags = [t.strip() for t in tags_part.split(",") if t.strip()]
        
        # Strict Normalization (Single Word, Lowercase, No Punctuation)
        normalized_tags = []
        stopwords = {'a', 'an', 'the', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 
                     'and', 'or', 'but', 'of', 'to', 'with', 'for', 'this', 'that', 
                     'there', 'it', 'he', 'she', 'they', 'looking', 'standing', 'holding'}

        for t in raw_tags:
             # Remove quotes
             clean = t.replace('"', '').replace("'", "")
             # Split into words
             words = clean.split()
             for w in words:
                 # Clean punctuation from edges
                 w = w.lower().strip('.,-!?:;"()[]{}')
                 if len(w) > 2 and w not in stopwords:
                     normalized_tags.append(w)
        
        # Deduplicate preserving order
        seen = set()
        tags = []
        for t in normalized_tags:
            if t not in seen:
                seen.add(t)
                tags.append(t)


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
    global torch_lib, app, AI_MODE, index, id_map
    cmd_type = command.get('type')
    payload = command.get('payload', {})
    req_id = payload.get('reqId')
    
    logger.info(f"Received command: {cmd_type}")

    response = {}
    if req_id:
         response['reqId'] = req_id

    if cmd_type == 'ping':
        response = {
            "type": "pong", 
            "timestamp": time.time(),
            "aiMode": AI_MODE,
            "vlmEnabled": (torch_lib is not None) # Available if Torch is loaded
        }

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

    elif cmd_type == 'save_index':
        logger.info("Saving FAISS index to disk...")
        try:
            save_faiss()
            response = {"type": "save_index_result", "success": True}
        except Exception as e:
            logger.error(f"Failed to save index: {e}")
            response = {"type": "save_index_result", "success": False, "error": str(e)}

    elif cmd_type == 'add_to_index':
        # payload: { vectors: [[...], ...], ids: [1, 2, ...] }
        vectors = payload.get('vectors', [])
        ids = payload.get('ids', [])
        
        # logger.info(f"Adding {len(vectors)} vectors to FAISS index.")
        try:
            if vectors and len(vectors) == len(ids):
                if index is None:
                    init_faiss()
                
                # Normalize
                X = np.array(vectors).astype('float32')
                faiss_lib.normalize_L2(X)
                
                start_idx = index.ntotal
                index.add(X)
                
                # Update ID Map
                for i, face_db_id in enumerate(ids):
                    id_map[start_idx + i] = face_db_id
                
                response = {"type": "add_to_index_result", "success": True, "count": len(vectors)}
            else:
                 response = {"type": "add_to_index_result", "success": False, "error": "Mismatch in vectors/ids length"}
        except Exception as e:
            logger.error(f"Failed to add to index: {e}")
            response = {"type": "add_to_index_result", "success": False, "error": str(e)}

    elif cmd_type == 'generate_thumbnail':
        # payload: { path: "...", width: 300, height: 300 (optional) }
        path_str = payload.get('path')
        width = payload.get('width', 300)
        
        logger.info(f"Generating thumbnail for: {path_str}")
        try:
            import base64
            from io import BytesIO
            from PIL import Image, ImageOps 
            
            # Robust Load (reuse logic if possible, but inline is safe)
            pil_img = None
            try:
                pil_img = Image.open(path_str)
                pil_img = ImageOps.exif_transpose(pil_img)
            except Exception as e:
                # RAW Fallback
                try:
                    logger.info("PIL load failed, trying rawpy...")
                    with rawpy.imread(path_str) as raw:
                        rgb = raw.postprocess(user_flip=None)
                        pil_img = Image.fromarray(rgb)
                except Exception as raw_e:
                     raise ValueError(f"Failed to load image: {e} | {raw_e}")

            # Resize
            if pil_img:
                pil_img.thumbnail((width, width))
                # Convert to RGB if needed (e.g. RGBA -> RGB for JPEG)
                if pil_img.mode in ('RGBA', 'P'):
                    pil_img = pil_img.convert('RGB')
                
                # Save to Buffer
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
        logger.info("Saving FAISS index (save_vector_index)...")
        try:
            save_faiss()
            response = {"success": True}
        except Exception as e:
            logger.error(f"Failed to save index: {e}")
            response = {"success": False, "error": str(e)}

    elif cmd_type == 'add_faces_to_vector_index':
        # payload: { faces: [{id, descriptor}, ...] }
        faces = payload.get('faces', [])
        logger.info(f"Adding {len(faces)} faces to FAISS index (add_faces_to_vector_index).")
        try:
            new_vectors = []
            new_ids = []
            
            for f in faces:
                if 'descriptor' in f and f['descriptor']:
                     # Descriptor might be list or bytes used by JS
                     # JS sends Array<number> usually
                     desc = f['descriptor']
                     if isinstance(desc, list):
                         new_vectors.append(desc)
                         new_ids.append(f['id'])
            
            if new_vectors:
                if index is None:
                    init_faiss()
                
                X = np.array(new_vectors).astype('float32')
                faiss_lib.normalize_L2(X)
                
                start_idx = index.ntotal
                index.add(X)
                
                for i, face_db_id in enumerate(new_ids):
                    id_map[start_idx + i] = face_db_id
                
                response = {"success": True, "count": len(new_ids)}
            else:
                 response = {"success": True, "count": 0}

        except Exception as e:
            logger.error(f"Failed to add faces to index: {e}")
            response = {"success": False, "error": str(e)}

    elif cmd_type == 'analyze_image':
        # Unified pipeline: Load -> Scan (Faces) -> Tag (VLM) -> Return
        t_start = time.time()
        
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        scan_mode = payload.get('scanMode', 'FAST')
        enable_vlm = payload.get('enableVLM', False)
        
        metrics = {'load': 0, 'scan': 0, 'tag': 0, 'total': 0}
        
        logger.info(f"Analyzing {photo_id} (Mode: {scan_mode}, VLM: {enable_vlm})...")
        
        # 1. Image Loading
        t_load_start = time.time()
        img = None
        
        # Inline Robust Loading
        try:
            from PIL import Image, ImageOps
            
            try:
                pil_img = Image.open(file_path)
                pil_img = ImageOps.exif_transpose(pil_img)
                rgb_img = np.array(pil_img)
                
                if len(rgb_img.shape) == 2:
                     rgb_img = cv2.cvtColor(rgb_img, cv2.COLOR_GRAY2RGB)
                elif rgb_img.shape[2] == 4:
                     rgb_img = cv2.cvtColor(rgb_img, cv2.COLOR_RGBA2RGB)
                     
                img = cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)
            except Exception as e:
                logger.warning(f"PIL Load failed: {e}. Trying RawPy...")
                with rawpy.imread(file_path) as raw:
                    rgb = raw.postprocess(use_camera_wb=True)
                    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        except Exception as e:
            logger.error(f"Failed to load image for analysis: {e}")
            # Fatal error for this file
            response = {"type": "analysis_result", "photoId": photo_id, "error": f"Image Load Failed: {str(e)}"}
            return response # EXIT
            
        metrics['load'] = (time.time() - t_load_start) * 1000
        
        # 2. Face Scanning
        t_scan_start = time.time()
        scan_results = []
        global_blur = 0.0
        
        try:
            if not app: init_insightface()
            
            # Param Selection
            target_size = (1280, 1280)
            det_thresh = DET_THRESH
            if scan_mode == 'BALANCED':
                target_size = (640, 640)
                det_thresh = 0.4
            elif scan_mode == 'MACRO':
                # "Deep Scan" - High Res + Low Threshold + TTA
                target_size = (1280, 1280) 
                det_thresh = 0.25
                
            init_insightface(providers=CURRENT_PROVIDERS, allowed_modules=ALLOWED_MODULES, det_size=target_size, det_thresh=det_thresh)
            
            faces = app.get(img)
            
            # --- Global Quality (VoL) ---
            try:
                 # Small resize for speed
                 h, w = img.shape[:2]
                 if max(h, w) > 1024:
                     s = 1024 / max(h, w)
                     small = cv2.resize(img, (int(w*s), int(h*s)))
                 else:
                     small = img
                 global_blur = estimate_blur(small)
            except: pass
            
            # Process Faces
            for face in faces:
                bbox = face.bbox.astype(int).tolist()
                kps = face.kps if hasattr(face, 'kps') else None
                expanded = smart_crop_landmarks(bbox, kps, img.shape[1], img.shape[0])
                
                # Check blur
                x1, y1, x2, y2 = bbox
                face_crop = img[max(0,y1):min(img.shape[0],y2), max(0,x1):min(img.shape[1],x2)]
                f_blur = estimate_blur(face_crop, target_size=112)
                f_ten = estimate_sharpness_tenengrad(face_crop, target_size=112)
                
                # Thresholds
                vol_th = BLUR_THRESH
                ten_th = 100.0
                if scan_mode == 'MACRO':
                    vol_th = 5.0
                    ten_th = 25.0
                    
                if (f_blur < vol_th) and (f_ten < ten_th):
                    continue # Skip blurry
                
                scan_results.append({
                    "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                    "descriptor": face.embedding.tolist() if hasattr(face, 'embedding') else [],
                    "score": float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                    "blurScore": float(f_blur)
                })
                
        except Exception as e:
            logger.error(f"Analysis (Scan) Error: {e}")
            # We continue to tagging even if scan fails? No, usually return error.

        # Test Time Augmentation (TTA) - Rotation Fallback
        # Force TTA if MACRO mode is requested, even if we found faces (to catch rotated ones missed by upright scan)
        if scan_mode == 'MACRO':
            logger.info("[TTA] MACRO mode: Initiating Rotation Augmentation (TTA)...")
            
            # Keep original results
            # We need to de-duplicate later.
            
            for rot_angle in [90, 180, 270]:
                try:
                    logger.info(f"[TTA] Trying rotation {rot_angle}...")
                    rotated_img = None
                    
                    # Rotate Image
                    if rot_angle == 90:
                        rotated_img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
                    elif rot_angle == 180:
                        rotated_img = cv2.rotate(img, cv2.ROTATE_180)
                    elif rot_angle == 270:
                        rotated_img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
                    else:
                        continue

                    # Run Detection
                    init_insightface(providers=CURRENT_PROVIDERS, allowed_modules=ALLOWED_MODULES, det_size=target_size, det_thresh=det_thresh) # Re-init params
                    r_faces = app.get(rotated_img)
                    logger.info(f"[TTA] Rotation {rot_angle}: Found {len(r_faces)} faces")

                    if len(r_faces) > 0:
                        # Transform Coordinates Back
                        orig_h, orig_w = img.shape[:2]
                        rot_h, rot_w = rotated_img.shape[:2]

                        for face in r_faces:
                            bbox = face.bbox.astype(int).tolist()
                            rx1, ry1, rx2, ry2 = bbox
                            
                            # Transformation Logic
                            nx1, ny1, nx2, ny2 = 0, 0, 0, 0
                            
                            if rot_angle == 90:
                                # 90 CW (OpenCV ROTATE_90_CLOCKWISE)
                                # Inverse: rx, ry are in Rotated Frame (W x H) -> Orig (H x W)
                                # x_orig = ry
                                # y_orig = orig_h - rx
                                pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                                orig_pts = []
                                for px, py in pts:
                                    ox = py
                                    oy = orig_h - px
                                    orig_pts.append((ox, oy))
                                    
                            elif rot_angle == 180:
                                # 180 Inverse
                                pts = [(rx1, ry1), (rx2, ry2)]
                                orig_pts = []
                                for px, py in pts:
                                    ox = orig_w - px
                                    oy = orig_h - py
                                    orig_pts.append((ox, oy))

                            elif rot_angle == 270:
                                # 270 (OpenCV ROTATE_90_COUNTERCLOCKWISE)
                                # Inverse:
                                # x_orig = orig_w - ry
                                # y_orig = rx
                                pts = [(rx1, ry1), (rx2, ry2), (rx1, ry2), (rx2, ry1)]
                                orig_pts = []
                                for px, py in pts:
                                    ox = orig_w - py
                                    oy = px
                                    orig_pts.append((ox, oy))
                            
                            # Bounding Box from Points
                            oxs = [p[0] for p in orig_pts]
                            oys = [p[1] for p in orig_pts]
                            nx1, nx2 = min(oxs), max(oxs)
                            ny1, ny2 = min(oys), max(oys)
                            
                            # Clamp
                            nx1, nx2 = max(0, nx1), min(orig_w, nx2)
                            ny1, ny2 = max(0, ny1), min(orig_h, ny2)

                            # Process Found Face
                            # Smart Crop on Original Image using new Box
                            expanded = smart_crop_landmarks([nx1, ny1, nx2, ny2], None, orig_w, orig_h)
                            
                            # Calculate Blur on Original Crop
                            face_crop = img[int(ny1):int(ny2), int(nx1):int(nx2)]
                            f_blur = estimate_blur(face_crop, target_size=112)
                            
                            # APPEND TO RESULTS
                            scan_results.append({
                                "box": {"x": expanded[0], "y": expanded[1], "width": expanded[2]-expanded[0], "height": expanded[3]-expanded[1]},
                                "descriptor": face.embedding.tolist() if hasattr(face, 'embedding') else [],
                                "score": float(face.det_score) if hasattr(face, 'det_score') else 0.0,
                                "blurScore": float(f_blur),
                                "rotation_fix": rot_angle
                            })

                except Exception as e:
                    logger.error(f"[TTA] Rotation {rot_angle} failed: {e}")
        
        # De-Duplicate (NMS - IoU Check)
        if len(scan_results) > 1:
            unique_faces = []
            # Sort by score desc
            scan_results.sort(key=lambda x: x['score'], reverse=True)
            
            for f in scan_results:
                box_a = f['box']
                is_dup = False
                for existing in unique_faces:
                    box_b = existing['box']
                    
                    # IoU Calculation
                    x1 = max(box_a['x'], box_b['x'])
                    y1 = max(box_a['y'], box_b['y'])
                    x2 = min(box_a['x'] + box_a['width'], box_b['x'] + box_b['width'])
                    y2 = min(box_a['y'] + box_a['height'], box_b['y'] + box_b['height'])
                    
                    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
                    area_a = box_a['width'] * box_a['height']
                    area_b = box_b['width'] * box_b['height']
                    
                    iou = inter_area / float(area_a + area_b - inter_area)
                    
                    if iou > 0.5: # 50% Overlap
                        is_dup = True
                        break
                
                if not is_dup:
                    unique_faces.append(f)
            
            scan_results = unique_faces
            logger.info(f"[TTA] Final Unique Faces after NMS: {len(scan_results)}")
        
        metrics['scan'] = (time.time() - t_scan_start) * 1000
        
        # 3. VLM Tagging
        t_tag_start = time.time()
        tags_result = []
        description_result = ""
        
        if enable_vlm:
            try:
                if not vlm_model: init_vlm()
                if vlm_model:
                     # Reuse the PIL image logic? generate_captions re-opens file.
                     # Optimizing to use in-memory image would require refactoring generate_captions to accept object.
                     # For safety/speed of impl, we call generate_captions(file_path) 
                     # BUT `generate_captions` loads file again.
                     # OPTIMIZATION: Refactor generate_captions or simple copy-paste logic here?
                     # Let's just call it for now. The file is in OS cache, so second load is fast-ish.
                     description_result, tags_result = generate_captions(file_path)
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
             # Check VLM availability (Lazy Init)
             if not vlm_model:
                 init_vlm()
             
             if vlm_model is None:
                 logger.warning("VLM is unavailable. Skipping tagging.")
                 response = {
                     "type": "tags_result",
                     "photoId": photo_id,
                     "tags": [],
                     "description": "",
                     "error": "VLM_UNAVAILABLE" 
                 }
                 # Allow execution to fall through or return immediately? 
                 # We must assign to response, but the code below tries to do 'response = ...' inside try.
                 # Let's verify structure.
             else:
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

    elif cmd_type == 'rotate_image':
        photo_id = payload.get('photoId')
        file_path = payload.get('filePath')
        rotation_angle = payload.get('rotation') # 90 or -90
        
        logger.info(f"Rotating image {photo_id} by {rotation_angle} degrees...")
        
        try:
            from PIL import Image, ImageOps
            
            # Open the image
            img = Image.open(file_path)
            
            # Apply Existing Orientation FIRST
            img = ImageOps.exif_transpose(img)
            
            # Rotate
            # PIL rotate is counter-clockwise.
            # Assume payload sends 90 for Right (Clockwise).
            # So Right (Clockwise 90) -> PIL rotate(-90).
            angle = -int(rotation_angle)
            rotated_img = img.rotate(angle, expand=True)
            
            # Save
            # We must preserve format.
            # We also strip the Orientation tag because we just baked it in.
            exif = rotated_img.getexif()
            if 0x0112 in exif:
                del exif[0x0112] # Remove Orientation tag
            
            # Overwrite original
            rotated_img.save(file_path, quality=95, exif=exif)
            full_w, full_h = rotated_img.size
            
            logger.info(f"Successfully rotated {file_path}")
            
            # Regenerate Preview (Generic max size)
            preview_dir = payload.get('previewStorageDir')
            if preview_dir:
                 preview_filename = f"preview_{photo_id}.jpg"
                 preview_path = os.path.join(preview_dir, preview_filename)
                 # Resize
                 max_dim = 1280
                 if full_w > max_dim or full_h > max_dim:
                     # Create a copy for thumbnailing to avoid modifying full size returned in response
                     preview_img = rotated_img.copy()
                     preview_img.thumbnail((max_dim, max_dim))
                     preview_img.save(preview_path, quality=80)
                 else:
                     rotated_img.save(preview_path, quality=80)

            response = {
                "type": "rotate_result",
                "photoId": photo_id,
                "success": True,
                "width": full_w,
                "height": full_h
            }
            
        except Exception as e:
            logger.error(f"Rotation Error: {e}")
            response = {"error": str(e), "photoId": photo_id}



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
                temp_zip = os.path.join(LIBRARY_PATH, "runtime_download.zip")
                # Ensure we start fresh by deleting any previous failed download
                if os.path.exists(temp_zip):
                    try: os.remove(temp_zip)
                    except: pass

                base_url = "https://github.com/arozz7/smart-photo-organizer/releases/download/v0.3.0/ai-runtime-win-x64.zip"
                
                # Check if multi-part exists (.001)
                parts = []
                total_estimated_size = 0
                part_idx = 1
                while True:
                    part_url = f"{base_url}.{str(part_idx).zfill(3)}"
                    try:
                        logger.info(f"Checking for part: {part_url}")
                        r = requests.head(part_url, allow_redirects=True)
                        if r.status_code == 200:
                            logger.info(f"Examples found part {part_idx}")
                            parts.append(part_url)
                            total_estimated_size += int(r.headers.get('content-length', 0))
                            part_idx += 1
                        else:
                            logger.warning(f"Part {part_idx} check failed with status: {r.status_code}")
                            break
                    except Exception as e:
                        logger.warning(f"Part check exception: {e}")
                        break
                
                if not parts:
                    # Fallback to single zip
                    logger.info("No multi-part runtime found, trying single zip...")
                    save_path = enhance.enhancer.download_model_at_url(
                        base_url,
                        temp_zip,
                        progress_callback
                    )
                else:
                    logger.info(f"Found {len(parts)} parts for AI Runtime. Downloading...")
                    bytes_so_far = 0
                    with open(temp_zip, 'wb') as f_out:
                        for p_url in parts:
                            logger.info(f"Downloading part: {p_url}")
                            r = requests.get(p_url, stream=True)
                            r.raise_for_status()
                            for chunk in r.iter_content(chunk_size=16384):
                                if chunk:
                                    f_out.write(chunk)
                                    bytes_so_far += len(chunk)
                                    if progress_callback:
                                        # Use estimated total if possible, otherwise use bytes_so_far
                                        progress_callback(bytes_so_far, total_estimated_size or bytes_so_far)
                    save_path = temp_zip
                
                logger.info("Extracting AI Runtime...")
                # Emit Extraction Status
                print(json.dumps({
                    "type": "download_progress",
                    "modelName": model_name,
                    "status": "extracting",
                    "current": total_estimated_size,
                    "total": total_estimated_size,
                    "percent": 100,
                    "reqId": req_id
                }))
                sys.stdout.flush()

                with zipfile.ZipFile(save_path, 'r') as zip_ref:
                    zip_ref.extractall(AI_RUNTIME_PATH)
                
                if os.path.exists(save_path):
                    os.remove(save_path) # Cleanup zip
                save_path = AI_RUNTIME_PATH
                
                # --- DYNAMIC RE-INJECTION ---
                logger.info("Attempting to inject new runtime...")
                if inject_runtime():
                    logger.info("Runtime injected. Re-initializing Global Modules...")
                    
                    # 1. Reload Torch
                    torch_lib = get_torch()
                    if torch_lib:
                        logger.info(f"Torch re-loaded: {torch_lib.__version__}")
                        # Apply patches
                        try:
                            import torchvision.transforms.functional as F
                            import types
                            mod = types.ModuleType("torchvision.transforms.functional_tensor")
                            mod.rgb_to_grayscale = F.rgb_to_grayscale
                            sys.modules["torchvision.transforms.functional_tensor"] = mod
                        except: pass
                        
                        # UPDATE STATUS
                        # global AI_MODE (Removed nested global)
                        if torch_lib.cuda.is_available():
                            AI_MODE = "GPU"
                        else:
                            AI_MODE = "CPU"
                    else:
                         logger.error("Failed to reload torch after injection")

                    # 2. Re-Init VLM (if enabled/requested)
                    # We won't auto-init to save mem, but set flag?
                    # The get_torch() above is key for next calls.
                    
                    # 3. Reload InsightFace if it was in safe mode?
                    # If we were in SAFE_MODE/CPU, we might want to switch to GPU
                    # But re-initing app is expensive. Let's just reset app and let next call re-init.
                    app = None 
                    logger.info("Backend re-init complete. Ready for GPU tasks.")
                else:
                    logger.warning("Runtime injection failed after download.")
            else:
                save_path = enhance.enhancer.download_model_with_progress(model_name, progress_callback)
            
            response = {
                "type": "download_result",
                "success": True,
                "modelName": model_name,
                "savePath": save_path,
                "reqId": req_id
            }
        except Exception as e:
            logger.exception("Download Error")
            error_msg = str(e)
            if isinstance(e, requests.exceptions.HTTPError):
                if e.response.status_code == 404:
                    error_msg = "Download resource not found (404). Please ensure the AI Runtime is uploaded to the GitHub release 'v0.3.0'."
                else:
                    error_msg = f"Server returned error {e.response.status_code}: {e}"
            
            response = {
                "type": "download_result",
                "success": False,
                "error": error_msg,
                "reqId": req_id
            }

    elif cmd_type == 'rebuild_index':
        descriptors = payload.get('descriptors', [])
        ids = payload.get('ids', [])
        logger.info(f"Rebuilding FAISS index with {len(descriptors)} vectors...")
        try:
            # global index, id_map # Removed to fix SyntaxError
            # We are writing to the global variables `index` and `id_map`. 
            # In Python, valid assignment to a global variable requires `global` keyword if it's in a local scope.
            # HOWEVER, if `index` was read before this line in the SAME BLOCK, it's an error.
            # But here it is at the start of try block.
            # Wait, the error says: "line 1462 ... SyntaxError: name 'index' is used prior to global declaration"
            # This usually means `index` was referenced in the function *before* the global keyword.
            # `handle_command` is a HUGE function. Did I use `index` earlier in `handle_command`?
            # Yes, I added `add_to_index` which uses `index`.
            # Solution: Move `global index, id_map` to the VERY TOP of `handle_command`.
            index = faiss_lib.IndexFlatL2(512)
            id_map = {}
            if descriptors:
                X = np.array(descriptors).astype('float32')
                faiss_lib.normalize_L2(X)
                index.add(X)
                for i, face_id in enumerate(ids):
                    id_map[i] = face_id
            save_faiss()
            response = {"type": "rebuild_index_result", "count": index.ntotal, "success": True, "reqId": req_id}
        except Exception as e:
            logger.exception("Index rebuild failed")
            response = {"error": str(e), "reqId": req_id}

    elif cmd_type == 'search_index':
        descriptor = payload.get('descriptor')
        k = payload.get('k', 10)
        threshold = payload.get('threshold', 0.6)
        if not descriptor or index is None or index.ntotal == 0:
            response = {"type": "search_result", "matches": [], "reqId": req_id}
        else:
            try:
                X = np.array([descriptor]).astype('float32')
                faiss_lib.normalize_L2(X)
                distances, indices = index.search(X, k)
                matches = []
                for dist, idx in zip(distances[0], indices[0]):
                    if idx == -1: continue
                    if dist > threshold: continue
                    face_id = id_map.get(int(idx))
                    if face_id is not None:
                        matches.append({"id": face_id, "distance": float(dist)})
                response = {"type": "search_result", "matches": matches, "reqId": req_id}
            except Exception as e:
                logger.exception("Search failed")
                response = {"error": str(e), "reqId": req_id}

    elif cmd_type == 'get_system_status':
        status = {}
        try:
            # 1. Models Status (Transparent listing)
            models_info = {}
            
            # Special markers for core libraries
            runtime_exists = os.path.exists(AI_RUNTIME_PATH)
            models_info["AI GPU Runtime (Torch/CUDA)"] = {
                "exists": runtime_exists,
                "url": "https://github.com/arozz7/smart-photo-organizer/releases/download/v0.3.0/ai-runtime-win-x64.zip",
                "size": 5800000000, # Approx 5.8GB
                "localPath": AI_RUNTIME_PATH,
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
                "size": os.path.getsize(os.path.expanduser('~/.insightface/models/buffalo_l/model-0000.params')) if os.path.exists(os.path.expanduser('~/.insightface/models/buffalo_l/model-0000.params')) else 0,
                "localPath": os.path.expanduser('~/.insightface/models/buffalo_l')
            }
            models_info["SmolVLM-Instruct"] = {
                "exists": os.path.exists(os.path.expanduser('~/.cache/huggingface/hub/models--HuggingFaceTB--SmolVLM-Instruct')),
                "url": "HuggingFace (SmolVLM-Instruct)",
                "size": os.path.getsize(os.path.expanduser('~/.cache/huggingface/hub/models--HuggingFaceTB--SmolVLM-Instruct/snapshots/f919106093554181f2113202970119100232491a/model.safetensors')) if os.path.exists(os.path.expanduser('~/.cache/huggingface/hub/models--HuggingFaceTB--SmolVLM-Instruct/snapshots/f919106093554181f2113202970119100232491a/model.safetensors')) else 0,
                "localPath": os.path.expanduser('~/.cache/huggingface/hub/models--HuggingFaceTB--SmolVLM-Instruct')
            }
            status['models'] = models_info

            # 2. InsightFace Status
            insightface_status = {'loaded': False}
            if app:
                providers = []
                try:
                    if hasattr(app, 'models') and 'detection' in app.models:
                        det_model = app.models['detection']
                        if hasattr(det_model, 'session'):
                            providers = det_model.session.get_providers()
                        elif hasattr(det_model, 'net') and hasattr(det_model.net, 'session'):
                            providers = det_model.net.session.get_providers()
                except Exception:
                    providers = ["Unknown"]
                insightface_status = {'loaded': True, 'providers': providers, 'det_thresh': DET_THRESH, 'blur_thresh': BLUR_THRESH}
            status['insightface'] = insightface_status

            # 3. FAISS Status
            status['faiss'] = {'loaded': index is not None, 'count': index.ntotal if index else 0}

            # 4. VLM Status
            status['vlm'] = {
                'loaded': vlm_model is not None,
                'model': 'SmolVLM-Instruct', # Static name for now
                'device': str(vlm_model.device) if vlm_model else None
            }

            # 5. Libraries Debug Info
            try:
                import onnxruntime
                onnx_info = onnxruntime.__version__
            except ImportError:
                onnx_info = "Not Found"
                
            runtime_dirs = []
            if os.path.exists(AI_RUNTIME_PATH):
                try:
                    runtime_dirs = os.listdir(AI_RUNTIME_PATH)
                except:
                    runtime_dirs = ["<Error listing dirs>"]

            status['system'] = {
                'python': sys.version.split()[0],
                'torch': torch_lib.__version__ if torch_lib else "Missing/Download Required",
                'cuda_available': torch_lib.cuda.is_available() if torch_lib else False,
                'cuda_device': torch_lib.cuda.get_device_name(0) if (torch_lib and torch_lib.cuda.is_available()) else "N/A",
                'onnxruntime': onnx_info,
                'opencv': cv2.__version__,
                'ai_runtime_exists': os.path.exists(AI_RUNTIME_PATH) if os.environ.get('IS_DEV') != 'true' else False,
                'ai_runtime_path': AI_RUNTIME_PATH if os.environ.get('IS_DEV') != 'true' else f"{AI_RUNTIME_PATH} (Ignored in Dev Mode)",
                'is_dev_mode': os.environ.get('IS_DEV') == 'true',
                'sys_path_head': sys.path[:3], # Show first few paths to verify injection
                'runtime_contents': runtime_dirs[:10] # Limit to 10 items
            }

            response = {"type": "system_status_result", "status": status, "reqId": req_id}
        except Exception as e:
            logger.error(f"Failed to get system status: {e}")
            response = {"type": "system_status_result", "error": str(e), "reqId": req_id}

    elif cmd_type == 'cluster_faces':
        # payload: { faces: [...] } OR { dataPath: '...' }
        faces_data = payload.get('faces', [])
        
        if 'dataPath' in payload:
            dpath = payload['dataPath']
            if os.path.exists(dpath):
                try:
                    with open(dpath, 'r') as f:
                        file_payload = json.load(f)
                        faces_data = file_payload.get('faces', [])
                    
                    # Cleanup (Handled by Electron)
                    # try: os.remove(dpath)
                    # except: pass
                except Exception as e:
                    logger.error(f"[Cluster] File Read Error: {e}")
        
        # Ensure req_id is preserved if passed
        if req_id is None:
            req_id = payload.get('reqId')

        logger.info(f"Clustering {len(faces_data)} faces... (ReqID: {req_id})")

        try:
            if not faces_data:
                response = {"type": "cluster_result", "clusters": [], "singles": [], "reqId": req_id}
            else:
                # import numpy as np # Global import used
                from sklearn.cluster import DBSCAN

                # Extract vectors
                descriptors = [f['descriptor'] for f in faces_data]
                ids = [f['id'] for f in faces_data]
                
                X = np.array(descriptors, dtype=np.float32)
                
                # NORMALIZE VECTORS (Critical for Euclidean to match Cosine)
                norm = np.linalg.norm(X, axis=1, keepdims=True)
                norm[norm == 0] = 1e-10
                X = X / norm

                # DBSCAN
                # Allow override from payload
                eps_val = float(payload.get('eps', 0.55))
                min_samples_val = int(payload.get('min_samples', 2))
                
                logger.info(f"Clustering {len(X)} faces with eps={eps_val}, min_samples={min_samples_val}")

                clustering = DBSCAN(eps=eps_val, min_samples=min_samples_val, metric="euclidean", n_jobs=-1).fit(X)
                
                labels = clustering.labels_
                
                clusters = {}
                singles = []

                for idx, label in enumerate(labels):
                    face_id = ids[idx]
                    lbl = int(label)
                    
                    if lbl == -1:
                        singles.append(face_id)
                    else:
                        if lbl not in clusters: clusters[lbl] = []
                        clusters[lbl].append(face_id)

                # Format as list of groups
                # Sort clusters by size (descending)
                cluster_list = []
                for lbl in clusters:
                    cluster_list.append(clusters[lbl])
                
                cluster_list.sort(key=len, reverse=True)

                response = {
                    "type": "cluster_result", 
                    "clusters": cluster_list, 
                    "singles": singles,
                    "reqId": req_id
                }

        except ImportError:
            logger.error("sklearn not found. Clustering unavailable.")
            # Fallback: All singles?
            # Or implement simple greedy clustering?
            # For now return error
            response = {"type": "cluster_result", "error": "AI Runtime Missing sklearn", "reqId": req_id}
        except Exception as e:
            logger.error(f"Clustering error: {e}")
            response = {"type": "cluster_result", "error": str(e), "reqId": req_id}

        except Exception as e:
            logger.error(f"Error getting status: {e}")
            response = {"error": str(e), "reqId": req_id}
    else:
        response = {"error": f"Unknown command: {cmd_type}", "reqId": req_id}
        
    # Inject request ID if present so Electron can map the promise
    if req_id is not None and "reqId" not in response: # Only add if not already present
        response['reqId'] = req_id
        
    return response

# --- MAIN LOOP ---

def main_loop():
    logger.info("AI Engine started. Waiting for commands...")
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break
            line = line.strip()
            if not line: continue
            
            command = json.loads(line)
            result = handle_command(command)
            # handle_command might have already printed progress messages
            # but it MUST return the final response object.
            if result:
                print(json.dumps(result))
                sys.stdout.flush()
        except Exception as e:
            logger.error(f"Loop error: {e}")
            try:
                print(json.dumps({"error": str(e)}))
                sys.stdout.flush()
            except: pass

if __name__ == '__main__':
    try:
        # Move initialization to the background or lazy-load to avoid long startup delay
        # We always try to init FAISS as it is small
        try:
             init_faiss()
        except Exception as e:
             logger.error(f"FAISS init failed: {e}")

        main_loop()
    except Exception as e:
        logger.critical(f"FATAL ERROR in Python Backend: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
