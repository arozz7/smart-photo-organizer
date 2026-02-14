import sys
import logging
from PIL import Image, ImageOps
import rawpy
import os
import json
import re

logger = logging.getLogger('ai_engine.vlm')

# --- GLOBALS & CONFIG ---
vlm_processor = None
vlm_model = None
VLM_ENABLED = False

# Config
VLM_TEMP = 0.2
VLM_MAX_TOKENS = 512

def init_vlm():
    global vlm_processor, vlm_model, VLM_ENABLED
    if vlm_model is not None:
        return

    logger.info("Initializing SmolVLM...")
    try:
        import torch
    except ImportError:
        logger.warning("Torch not found. VLM (Smart Tagging) will be disabled.")
        vlm_model = None
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
                 from transformers import AutoModelForVision2Seq
                 vlm_model = AutoModelForVision2Seq.from_pretrained(
                    "HuggingFaceTB/SmolVLM-Instruct",
                    torch_dtype=dtype,
                    _attn_implementation="eager"
                )
            
            if device == "cuda":
               logger.info("Moving SmolVLM to CUDA...")
               vlm_model.to("cuda")
                
        logger.info("SmolVLM initialized.")
        VLM_ENABLED = True
    except Exception as e:
        logger.error(f"Failed to init SmolVLM: {e}")
        vlm_model = None
        VLM_ENABLED = False

def generate_captions(image_path):
    # Lazy Init
    if not vlm_model:
        init_vlm()
    
    if not vlm_model:
        raise RuntimeError("VLM failed to initialize")

    import torch
    logger.debug(f"Generating tags for {image_path}...")

    # Robust Image Loading
    try:
        pil_img = Image.open(image_path)
        pil_img = ImageOps.exif_transpose(pil_img) # Handle EXIF
        if pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')
    except Exception as e:
        # Fallback for RAW files
        try:
            logger.debug("PIL failed, attempting to read as RAW...")
            with rawpy.imread(image_path) as raw:
                rgb = raw.postprocess(user_flip=None) # Auto-rotate
                pil_img = Image.fromarray(rgb)
            logger.debug("Successfully read RAW file.")
        except Exception as raw_e:
            logger.warning(f"PIL and RawPy read failed: {e} | {raw_e}")
            raise ValueError(f"Could not read image: {e} | {raw_e}")

    # Prompt
    prompt = "Analyze this image. Format your response exactly like this:\nDescription: <detailed description>\nTags: <comma separated list of 10 keywords>"
    
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
    
    logger.debug("Encoding inputs...")
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    inputs = vlm_processor(text=text_prompt, images=[pil_img], return_tensors="pt")
    inputs = inputs.to(vlm_model.device)
    
    logger.debug("Running generation...")
    with torch.no_grad():
        generated_ids = vlm_model.generate(**inputs, max_new_tokens=VLM_MAX_TOKENS, temperature=VLM_TEMP, do_sample=(VLM_TEMP > 0))
    
    logger.debug("Decoding output...")
    # Setup for slicing: get input length
    if hasattr(inputs, 'input_ids'):
         input_len = inputs.input_ids.shape[1]
    else:
         input_len = 0 

    # Slice the generated_ids to only get new tokens
    new_ids = generated_ids[:, input_len:]
    generated_text = vlm_processor.batch_decode(new_ids, skip_special_tokens=True)
    full_text = generated_text[0].strip()
    
    logger.info(f"VLM Raw Output: {full_text}")
    
    # Parsing
    description = full_text
    tags = []
    
    # Robust Parsing
    lower_text = full_text.lower()
    
    # Find Tags section
    tag_splitors = ["tags:", "keywords:", "attributes:"]
    split_idx = -1
    used_splitor = ""
    
    for s in tag_splitors:
        idx = lower_text.rfind(s)
        if idx != -1:
            split_idx = idx
            used_splitor = s
            break
            
    if split_idx != -1:
        # Extract Parts
        desc_part = full_text[:split_idx].strip()
        tags_part = full_text[split_idx + len(used_splitor):].strip()
        
        # Clean Description
        if desc_part.lower().startswith("description:"):
            description = desc_part[12:].strip()
        else:
            description = desc_part
            
        logger.info(f"Raw Tags Part: {tags_part}")
        
        # Parse Tags (Handle commas and newlines)
        separators = [',', '\n', ';']
        raw_tags = []
        
        # Normalize separators to commas
        clean_tags_part = tags_part
        for sep in separators:
            clean_tags_part = clean_tags_part.replace(sep, ',')
            
        raw_tags = [t.strip() for t in clean_tags_part.split(",") if t.strip()]
        
        # Strict Normalization
        normalized_tags = []
        stopwords = {'a', 'an', 'the', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 
                     'and', 'or', 'but', 'of', 'to', 'with', 'for', 'this', 'that', 
                     'there', 'it', 'he', 'she', 'they', 'looking', 'standing', 'holding'}

        for t in raw_tags:
             clean = t.replace('"', '').replace("'", "").replace(".", "")
             words = clean.split()
             # If single word tag
             if len(words) == 1:
                 w = words[0].lower().strip('.,-!?:;"()[]{}')
                 if len(w) > 2 and w not in stopwords:
                     normalized_tags.append(w)
             else:
                 # Multi-word tag (keep as is but lowercase?)
                 # Usually users want single keywords, but "Donald Duck" is valid.
                 # Let's keep multi-word tags if they aren't too long
                 if len(words) < 4:
                     normalized_tags.append(clean.lower())

        # Deduplicate
        seen = set()
        tags = []
        for t in normalized_tags:
            if t not in seen:
                seen.add(t)
                tags.append(t)

        tags = tags[:15] # Take top 15
    else:
        logger.warning("Could not find 'Tags:' separator in VLM output. Using fallback extraction.")
        description = full_text
        
        # Fallback: Extract tags from description
        normalized_tags = []
        stopwords = {'a', 'an', 'the', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 
                     'and', 'or', 'but', 'of', 'to', 'with', 'for', 'this', 'that', 
                     'there', 'it', 'he', 'she', 'they', 'looking', 'standing', 'holding',
                     'background', 'foreground', 'picture', 'image', 'photo', 'can', 'see'}

        words = full_text.split()
        for w in words:
             clean = w.lower().strip('.,-!?:;"()[]{}')
             if len(clean) > 2 and clean not in stopwords:
                 normalized_tags.append(clean)

        # Deduplicate
        seen = set()
        tags = []
        for t in normalized_tags:
            if t not in seen:
                seen.add(t)
                tags.append(t)

        tags = tags[:10] # Take top 10 from fallback

    return description, tags

def verify_is_face(image_path, box):
    """
    Use VLM to verify if a cropped region is a human face.
    
    Args:
        image_path: Path to the source image
        box: Dict with x1, y1, x2, y2 coordinates
    
    Returns:
        {
            "is_face": bool | None,  # None if VLM error
            "confidence": float,
            "reason": str | None,
            "error": str | None
        }
    """
    # Lazy Init
    if not vlm_model:
        init_vlm()
    
    if not vlm_model:
        logger.error("VLM not initialized, cannot verify face")
        return {
            "is_face": None,
            "confidence": 0.0,
            "reason": None,
            "error": "VLM not initialized"
        }
    
    import torch
    from config import VLM_VERIFICATION_PROMPT
    
    logger.debug(f"Verifying face region in {image_path}: {box}")
    
    try:
        # Load and crop image
        try:
            pil_img = Image.open(image_path)
            pil_img = ImageOps.exif_transpose(pil_img)
            if pil_img.mode != 'RGB':
                pil_img = pil_img.convert('RGB')
        except Exception as e:
            # Fallback for RAW files
            try:
                logger.debug("PIL failed, attempting to read as RAW...")
                with rawpy.imread(image_path) as raw:
                    rgb = raw.postprocess(user_flip=None)
                    pil_img = Image.fromarray(rgb)
            except Exception as raw_e:
                logger.error(f"Failed to load image: {e} | {raw_e}")
                return {
                    "is_face": None,
                    "confidence": 0.0,
                    "reason": None,
                    "error": f"Image load failed: {e}"
                }
        
        # Crop to face region with padding (Phase 56.8 Accuracy Fix)
        # 25% padding provides more context to distinguish features from skin patches (e.g. knees).
        x1, y1, x2, y2 = box['x1'], box['y1'], box['x2'], box['y2']
        
        # [Fix] Robust Normalization (Handle rare inverted coordinates)
        x1, x2 = min(x1, x2), max(x1, x2)
        y1, y2 = min(y1, y2), max(y1, y2)
        
        bw, bh = x2 - x1, y2 - y1
        pad_w, pad_h = bw * 1.0, bh * 1.0
        
        # Apply padding and clamp to image boundaries
        img_w, img_h = pil_img.size
        cx1 = max(0, x1 - pad_w)
        cy1 = max(0, y1 - pad_h)
        cx2 = min(img_w, x2 + pad_w)
        cy2 = min(img_h, y2 + pad_h)
        
        # [Fix] Coordinate 'right' is less than 'left' safety check
        if cx2 <= cx1 or cy2 <= cy1:
             logger.warning(f"[VLM] Invalid crop coordinates calculated: ({cx1},{cy1},{cx2},{cy2}). Fallback to original box.")
             # Fallback to original tight box, clamped
             cx1 = max(0, min(x1, img_w - 1))
             cy1 = max(0, min(y1, img_h - 1))
             cx2 = max(cx1 + 1, min(x2, img_w))
             cy2 = max(cy1 + 1, min(y2, img_h))

        face_crop = pil_img.crop((cx1, cy1, cx2, cy2))
        
        # [Phase 56.5 Debug] Save VLM crops for visual verification
        #try:
            #import uuid
            #import tempfile
            #debug_dir = os.path.join(tempfile.gettempdir(), "vlm_debug")
            #os.makedirs(debug_dir, exist_ok=True)
            #debug_path = os.path.join(debug_dir, f"vlm_{uuid.uuid4().hex[:8]}.jpg")
            #face_crop.save(debug_path)
            #logger.info(f"[VLM] Debug crop saved to: {debug_path}")
        #except Exception as de:
            #logger.warning(f"[VLM] Failed to save debug crop: {de}")
        
        # [Refactor] Use analyze_face_crop helper (Phase 87)
        # 1. Standard Upright Verification
        result = analyze_face_crop(face_crop)
        
        # [Phase 87 Fix] Test Time Augmentation (TTA) for Rotated Faces
        if result.get('is_face') is False:
             # Detector finds them (in Macro mode), but VLM sees a sideways/upside-down crop and rejects them.
             # We try rotating the crop to find the "upright" orientation for the VLM.
             # Order: 180 (Most common "inverted" case), then 90 (CW), then 270 (CCW)
             rotations_to_try = [180, 90, 270]
             
             logger.info(f"[VLM] Initial verification failed (Reason: {result.get('reason')}). Trying TTA {rotations_to_try}...")
             
             for angle in rotations_to_try:
                 try:
                     rotated_crop = face_crop.rotate(angle, expand=True) # expand=True to keep corners
                     result_rotated = analyze_face_crop(rotated_crop, original_reason_prefix=f"[TTA-{angle}]")
                     
                     if result_rotated.get('is_face') is True:
                         logger.info(f"[VLM] TTA Success! Face confirmed at {angle} degrees.")
                         return result_rotated
                     else:
                         logger.debug(f"[VLM] TTA {angle} Failed.")
                 except Exception as tta_e:
                     logger.warning(f"[VLM] TTA {angle} Error: {tta_e}")
        
        return result
        
    except Exception as e:
        logger.error(f"[VLM] Verification Error: {e}")
        return {
            "is_face": None,
            "confidence": 0.0,
            "reason": None,
            "error": f"Verification Error: {e}"
        }


def analyze_face_crop(face_crop, original_reason_prefix=""):
    """
    Internal helper to run VLM on a PIL crop.
    Helper for verify_is_face to allow TTA (Test Time Augmentation).
    """
    global vlm_processor, vlm_model
    
    # Prepare VLM prompt
    from config import VLM_VERIFICATION_PROMPT, AI_CONFIG
    import json
    import re
    
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": VLM_VERIFICATION_PROMPT}
            ]
        }
    ]
    
    text_prompt = vlm_processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    inputs = vlm_processor(text=text_prompt, images=[face_crop], return_tensors="pt")
    inputs = inputs.to(vlm_model.device)
    
    # [Phase 79] Robust Generation Loop with Retry
    max_retries = 3
    current_try = 0
    response = ""
    is_garbage_final = False

    while current_try < max_retries:
        current_try += 1
        temp = 0.1 + (current_try - 1) * 0.2
        
        with torch.no_grad():
            generated_ids = vlm_model.generate(
                **inputs, 
                max_new_tokens=300, 
                temperature=temp, 
                do_sample=False if temp < 0.2 else True,
                repetition_penalty=1.35
            )
        
        if hasattr(inputs, 'input_ids'):
            input_len = inputs.input_ids.shape[1]
        else:
            input_len = 0
        
        new_ids = generated_ids[:, input_len:]
        generated_text = vlm_processor.batch_decode(new_ids, skip_special_tokens=True)
        response = generated_text[0].strip()
        
        # Garbage Detection
        is_garbage = False
        lower_resp = response.lower()
        garbage_patterns = ['<html>', '<body', 'cloudflare', 'function()', 'var ', 'const ', 'jquery', '// ', '/*']
        if any(x in lower_resp for x in garbage_patterns):
            is_garbage = True
            logger.warning(f"[VLM] Garbage/Hallucination detected (pattern match) (Try {current_try}/{max_retries}): {response[:50]}...")
        
        if not is_garbage:
            try:
                # [Fix] Strictly require "is_face" (quoted or unquoted)
                if '"is_face"' not in lower_resp and "'is_face'" not in lower_resp and "is_face" not in lower_resp:
                        if response.strip().startswith('{') or response.strip().startswith('```'):
                            is_garbage = True
                            logger.warning(f"[VLM] Hallucinated JSON detected (missing 'is_face') (Try {current_try}/{max_retries})")
            except:
                pass

        if not is_garbage:
            is_garbage_final = False
            break 
        else:
            is_garbage_final = True
            
    logger.info(f"[VLM] Verification Response: {response}")
    
    # Fail Open if still garbage
    if is_garbage_final:
        logger.warning("[VLM] Max retries reached with garbage output. FAILING OPEN (Accepting Face).")
        return {
            "is_face": True,
            "confidence": 0.5,
            "reason": "VLM Generation Failure (Fail Open)",
            "error": None
        }
    
    try:
        # 1. Clean response
        clean_response = response.strip()
        clean_response = clean_response.replace("```json", "").replace("```", "").strip()

        # [Phase 82] Robust Text Parsing
        # [Phase 89 Fix] Split on actual newlines, not literal '\\n'
        lines = clean_response.replace('\\n', '\n').split('\n')
        parsed = {}
        
        for line in lines:
            line = line.strip()
            if ':' in line:
                key, val = line.split(':', 1)
                key = key.strip().upper()
                val = val.strip()
                
                if key == 'IS_FACE':
                    parsed['is_face'] = (val.upper() == 'YES')
                elif key == 'CONFIDENCE':
                    try:
                        parsed['confidence'] = float(val)
                    except:
                        parsed['confidence'] = 0.5
                elif key == 'OBJECT':
                    parsed['specific_object'] = val.lower()
                elif key == 'DESCRIPTION':
                    parsed['description'] = val
        
        # Defaults
        is_face = parsed.get('is_face', False)
        confidence = parsed.get('confidence', 0.5)
        category = 'face' if is_face else 'none'
        obj_type = parsed.get('specific_object', 'unknown')
        reason = parsed.get('description', 'No description provided')
        landmarks = '' 
        
        # Fallback for 'IS_FACE' missing
        if 'is_face' not in parsed:
            if 'YES' in clean_response.upper() and 'NO' not in clean_response.upper():
                is_face = True
                confidence = 0.6
            elif 'NO' in clean_response.upper():
                is_face = False
                confidence = 0.8
            else:
                # [Phase 89.4] Ambiguous responses should FAIL CLOSED, not open.
                # If VLM can't clearly say YES or NO, reject — Phase 89.2 override handles real faces.
                logger.warning(f"[VLM] Ambiguous text response. FAILING CLOSED. Response: {clean_response}")
                is_face = False
                confidence = 0.3
        
        if obj_type and obj_type not in reason:
            reason += f" (object: {obj_type})"

        # [Phase 57.1] STRICT WORD BOUNDARY MATCHING
        def has_word(text, terms):
            for term in terms:
                if re.search(r'\b' + re.escape(term) + r'\b', text, re.IGNORECASE):
                    return True
            return False

        # [Phase 56.9] MANDATORY ANATOMICAL CHECK
        anatomical_terms = [
            "eye", "nose", "mouth", "lip", "chin", "ear", "eyebrow", "cheek", 
            "forehead", "hairline", "profile", "smile", "nostril", "eyelid", "head"
        ]
        has_anatomical = has_word(reason, anatomical_terms)

        face_proof = [
            "smiling", "smile", "expression", "glasses", "beard", "mustache", 
            "tilted head", "head angle", "profile view", 
            "side-view", "side view", 
            "girl", "boy", "man", "woman", "child", "baby", "lady", "gentleman",
            "bride", "groom", "infant", "toddler", "couple",
            "men", "women", "children", "people", "adults", "faces"
        ]
        has_face_proof = has_word(reason, face_proof)

        # [Phase 56.9.1] HARD CATEGORY OVERRIDE
        non_face_categories = ["false_positive", "false-positive", "skin", "body", "fabric", "background", "clothing"]
        non_face_objs = AI_CONFIG.get('vlm', {}).get('forbidden_objects', [
            "knee", "shoulder", "skin_patch", "arm", "leg", "elbow", "foot", "body_part", "hand", "finger", 
            "hat", "cap", "camera", "microphone" 
        ])
        
        is_categorized_non_face = any(c in category for c in non_face_categories) or any(o in obj_type for o in non_face_objs)
        
        if is_face is True and is_categorized_non_face:
            hit_objs = [o for o in non_face_objs if o in obj_type]
            hand_related = ["hand", "finger", "arm", "elbow", "shoulder"]
            is_only_hand = len(hit_objs) > 0 and all(h in hand_related for h in hit_objs)
            
            if is_only_hand and (has_anatomical or has_face_proof):
                logger.info(f"[VLM] Hand/Arm detected ('{obj_type}') but IGNORED rejection because anatomical/subject features found: {reason}")
            else:
                logger.warning(f"[VLM] Categorized as {category}/{obj_type}. Forcing is_face=False.")
                is_face = False
                reason = f"Categorized as {category}/{obj_type} ({reason})"

        # [Phase 56.9] AGGRESSIVE ECHO STRIPPING
        echo_terms = [
            "list 2+", "specific anatomical", "parts seen", "seen or", 
            "specific facial", "facial parts", "be specific and honest",
            "json with these fields", "valid json", "characterize exactly",
            "catching errors", "automated face detector"
        ]
        if any(term in landmarks for term in echo_terms):
            landmarks = "unknown"
        if any(term in reason for term in echo_terms):
            reason = "unknown"
        
        logger.info(f"[VLM] Parsed Result: is_face={is_face}, cat={category}, obj={obj_type}, landmarks={landmarks}")
        
        # [Phase 56.5] LANDMARK VALIDATION
        # [Phase 89.4] Require descriptive evidence — bare claims without evidence are hallucinations.
        # If VLM can't describe what it sees, it shouldn't be trusted.
        if is_face is True:
            # Re-define face_proof (local scope)
            face_proof = [
                "smiling", "smile", "expression", "glasses", "beard", "mustache",
                "tilted head", "head angle", "profile view",
                "side-view", "side view",
                "girl", "boy", "man", "woman", "child", "baby", "lady", "gentleman",
                "bride", "groom", "infant", "toddler", "couple",
                "men", "women", "children", "people", "adults", "faces"
            ]

            has_category_proof = category and category.lower() == "face"

            if has_anatomical or has_word(reason, face_proof):
                # Real evidence exists in the description — trust it
                logger.info(f"[VLM] Trusting face: Evidence found in description.")
            elif has_category_proof and not (has_anatomical or has_word(reason, face_proof)):
                # [Phase 89.4] Category='face' but NO descriptive evidence.
                # This is the hallucination pattern: VLM says "Object: Face" with empty description.
                # Real faces almost always produce SOME description (eyes, nose, man, woman, etc.).
                # Bare category claims are unreliable — reject and let Phase 89.2 override handle
                # truly high-confidence detections on the TypeScript side (score >= 0.82 AND quality >= 0.70).
                logger.warning(f"[VLM] Rejecting bare category claim 'face' with NO descriptive evidence (Confidence: {confidence:.4f}). Likely hallucination.")
                is_face = False
                reason = f"Bare category claim without evidence (hallucination guard)"
            else:
                logger.warning(f"[VLM] Overriding is_face=True -> False because NO anatomical proof was found in text (Confidence: {confidence:.4f}).")
                is_face = False
                reason = f"No anatomical proof in description (reason: {reason})"
        
        # [Phase 56.9] Secondary Safeguards
        if is_face is True:
            non_face_keywords = AI_CONFIG.get('vlm', {}).get('forbidden_keywords', [
                "knee", "elbow", "arm", "leg", "foot", "hand", "finger",
                "chair", "furniture", "wood", "floor", "ground", "pants", "jeans", "shirt", "clothing", "fabric",
                "rock", "stone", "concrete", "pavement", "foliage", "leaf", "plant", "grass", "tree"
            ])
            person_indicators = ["face", "man", "woman", "boy", "girl", "baby", "person", "child", "men", "women", "people", "male", "female", "human"]
            
            for kw in non_face_keywords:
                if kw in reason:
                    has_person = any(p in reason for p in person_indicators)
                    if not has_person and not has_anatomical and not has_face_proof:
                        logger.warning(f"[VLM] Overriding is_face=True -> False because reason mentioned non-face keyword '{kw}': '{reason}'")
                        is_face = False
                        break
                    elif has_anatomical or has_face_proof:
                         logger.info(f"[VLM] Keyword '{kw}' found but ignored due to valid face proof: {reason}")
        
        # [Phase 63.5] Generic Hallucination Filter
        if is_face is True:
            generic_phrases = [
                "face is visible", "the object is a face", 
                "facial features are visible", "person's face", "a face",
                "visible face", "human head", "the image contains a face",
                "close-up of a face"
            ]
            clean_reason = reason.lower().strip().strip(".").strip()
            is_generic = any(clean_reason == gp or clean_reason == f"a {gp}" or clean_reason == f"the {gp}" for gp in generic_phrases)
            
            if not is_generic:
                 for gp in generic_phrases:
                     if gp in clean_reason and len(clean_reason) < 45: 
                         is_generic = True
                         break
            
            if is_generic:
                details = [
                    "pink", "blue", "red", "green", "hair", " dress", "shirt", "eyes", "nose", "mouth", "smile", "looking",
                    "woman", "man", "boy", "girl", "baby", "child", "person", "lady", "gentleman",
                    "bride", "groom", "infant", "toddler", "couple", "people", "portrait",
                    "beautiful", "pretty", "human", "mask", "costume", "makeup", 
                    "men", "women", "adults", "faces"
                ]
                has_detail = has_word(clean_reason, details)
                if has_detail:
                     is_generic = False 
                else:
                     logger.warning(f"[VLM] Generic description ('{clean_reason}') REJECTED (No details).")
                
                if not has_detail:
                    logger.warning(f"[VLM] Overriding is_face=True -> False. Reason is too generic ('{reason}') and lacks specific details.")
                    is_face = False
                    reason = f"Generic Hallucination Detected (reason: {reason})"
        
        # [Phase 68] Extract Suggested Metadata
        suggested_metadata = {}
        mining_text = (str(reason) + " " + str(obj_type)).lower()
        
        if any(w in mining_text for w in ["woman", "girl", "lady", "bride", "mother", "female"]):
            suggested_metadata['gender'] = "F"
        elif any(w in mining_text for w in ["man", "boy", "gentleman", "groom", "father", "male"]):
            suggested_metadata['gender'] = "M"
            
        if any(w in mining_text for w in ["baby", "infant", "toddler"]):
            suggested_metadata['age'] = 2
        elif any(w in mining_text for w in ["child", "kid", "boy", "girl"]):
            if "woman" not in mining_text and "man" not in mining_text:
                suggested_metadata['age'] = 10

        multi_face_terms = ["two", "couple", "group", "multiple", "heads together", "three", "pair", "men", "women"]
        parents = ["woman", "man", "mother", "father", "lady", "gentleman"]
        children = ["baby", "child", "infant", "toddler", "kid", "boy", "girl"]
        has_parent = has_word(mining_text, parents)
        has_child = has_word(mining_text, children)

        if has_word(mining_text, multi_face_terms) or (has_parent and has_child):
             suggested_metadata['is_multi_face'] = True
             logger.info(f"[VLM] Multi-Face Detected: '{reason}'. Flagging for split.")

        elif any(w in mining_text for w in ["adult", "woman", "man", "elderly", "senior"]):
            suggested_metadata['age'] = 30 
        
        if original_reason_prefix:
            reason = f"{original_reason_prefix} {reason}"

        return {
            "is_face": is_face,
            "confidence": confidence,
            "reason": reason,
            "suggested_metadata": suggested_metadata,
            "error": None
        }
    except (json.JSONDecodeError, ValueError, Exception) as e:
        logger.debug(f"Parsing failed, falling back to heuristic. Error: {e}")
        
        # Heuristic Fallback
        response_cleaned = re.sub(r'//.*?(?=\\n|$)', '', response, flags=re.MULTILINE)
        response_lower = response_cleaned.lower()
        
        facial_features = [
            r'\\beyes?\\b', r'\\bnose\\b', r'\\bmouth\\b', r'\\bsmile\\b', r'\\bsmiling\\b',
            r'\\blips?\\b', r'\\bcheeks?\\b', r'\\bchin\\b', r'\\bforehead\\b', r'\\beyebrows?\\b',
            r'\\beyelash', r'\\bpupil', r'\\biris\\b'
        ]
        has_facial_features = any(re.search(pattern, response_lower) for pattern in facial_features)
        
        forbidden_keywords = [
            'sand', 'beach', 'ocean', 'water', 'wave',
            'rock', 'stone', 'ground', 'floor',
            'leaf', 'leaves', 'tree', 'plant', 'foliage'
        ]
        has_forbidden = any(keyword in response_lower for keyword in forbidden_keywords)
        
        has_is_face_true = '"is_face": true' in response_lower or '"is_face":true' in response_lower
        has_yes_prefix = "yes" in response_lower[:10]
        
        if has_facial_features:
             # Real evidence: VLM described facial anatomy — trust it
             return {
                 "is_face": True,
                 "confidence": 0.5,
                 "reason": "Heuristic fallback: detailed facial features description",
                 "error": None
             }
        elif has_forbidden:
             return {
                 "is_face": False,
                 "confidence": 0.8,
                 "reason": "Heuristic fallback: forbidden keywords",
                 "error": None
             }
        elif has_is_face_true or has_yes_prefix:
             # [Phase 89.4] Bare claims without descriptive evidence — reject.
             # Previously these accepted faces just from "is_face: true" or bare "Yes".
             # Without facial features in the description, this is unreliable.
             # Phase 89.2 override (score >= 0.82 AND quality >= 0.70) provides safety net.
             tag = "JSON key" if has_is_face_true else "'Yes' prefix"
             logger.warning(f"[VLM] Heuristic fallback: bare {tag} without facial features — rejecting as hallucination.")
             return {
                 "is_face": False,
                 "confidence": 0.3,
                 "reason": f"Heuristic fallback: bare {tag} without evidence (hallucination guard)",
                 "error": None
             }
        else:
             is_face = False
        
        confidence = 0.9 if is_face else 0.1
        reason = response.strip()
        
        suggested_metadata = {} 
        return {
            "is_face": is_face,
            "confidence": confidence,
            "reason": reason,
            "suggested_metadata": suggested_metadata,
            "error": None
        }

