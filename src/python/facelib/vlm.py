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
        bw, bh = x2 - x1, y2 - y1
        pad_w, pad_h = bw * 0.25, bh * 0.25
        
        # Apply padding and clamp to image boundaries
        img_w, img_h = pil_img.size
        cx1 = max(0, x1 - pad_w)
        cy1 = max(0, y1 - pad_h)
        cx2 = min(img_w, x2 + pad_w)
        cy2 = min(img_h, y2 + pad_h)
        
        face_crop = pil_img.crop((cx1, cy1, cx2, cy2))
        
        # [Phase 56.5 Debug] Save VLM crops for visual verification
        try:
            import uuid
            import tempfile
            debug_dir = os.path.join(tempfile.gettempdir(), "vlm_debug")
            os.makedirs(debug_dir, exist_ok=True)
            debug_path = os.path.join(debug_dir, f"vlm_{uuid.uuid4().hex[:8]}.jpg")
            face_crop.save(debug_path)
            logger.info(f"[VLM] Debug crop saved to: {debug_path}")
        except Exception as de:
            logger.warning(f"[VLM] Failed to save debug crop: {de}")
        
        # Prepare VLM prompt
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
        
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        inputs = vlm_processor(text=text_prompt, images=[face_crop], return_tensors="pt")
        inputs = inputs.to(vlm_model.device)
        
        # Generate response
        with torch.no_grad():
            generated_ids = vlm_model.generate(**inputs, max_new_tokens=100, temperature=0.1, do_sample=False)
        
        # Decode
        if hasattr(inputs, 'input_ids'):
            input_len = inputs.input_ids.shape[1]
        else:
            input_len = 0
        
        new_ids = generated_ids[:, input_len:]
        generated_text = vlm_processor.batch_decode(new_ids, skip_special_tokens=True)
        response = generated_text[0].strip()
        
        logger.info(f"VLM Verification Response: {response}")
        
        # [Phase 58] Parse JSON response (semantic verification only)
        try:
            import json
            import re
            
            # 1. Clean response: remove markdown code blocks or "Answer:" prefixes
            clean_response = response.strip()
            if clean_response.startswith("```json"):
                clean_response = clean_response[7:-3].strip()
            elif clean_response.startswith("```"):
                clean_response = clean_response[3:-3].strip()
            elif "Answer:" in clean_response:
                # Extract everything after "Answer:"
                clean_response = clean_response.split("Answer:", 1)[1].strip()
                
            # 2. Try to find JSON block {...} if not a direct match
            if not (clean_response.startswith("{") and clean_response.endswith("}")):
                match = re.search(r"\{.*\}", clean_response, re.DOTALL)
                if match:
                    clean_response = match.group(0)
            
            # 3. Parse as JSON
            parsed = json.loads(clean_response)
            is_face = parsed.get('is_face', False)
            confidence = float(parsed.get('confidence', 0.5))
            landmarks = str(parsed.get('landmarks_visible', '')).lower()
            reason = str(parsed.get('reason', '')).lower()
            
            # [Phase 56.8] Strip prompt echoing from landmarks
            if "list specific" in landmarks or "seen or" in landmarks:
                logger.debug(f"[VLM] Strip landmark prompt echo: {landmarks}")
                landmarks = "unknown"
            
            logger.info(f"[VLM] Parsed Result: is_face={is_face}, landmarks={landmarks}, reason='{reason}'")
            
            # [Phase 56.5] LANDMARK VALIDATION
            # CRITICAL: If VLM admits there are no landmarks, it's NOT a face, regardless of what it thinks as a whole.
            # This catches hallucinations where it says "Yes, it's a person smiling" but then says landmarks: "none".
            if is_face is True and (landmarks == 'none' or not landmarks or 'none' in landmarks or 'unknown' in landmarks):
                # [Phase 56.8] STRONG CONFIDENCE EXCEPTION (SKEPTICAL)
                # If the model is nearly certain (>0.995), trust it even without standard landmarks.
                if confidence >= 0.995:
                    logger.info(f"[VLM] Trusting face despite 'none' landmarks due to extreme confidence ({confidence:.3f})")
                else:
                    # [Phase 56.6/7/8] SPECIAL EXCEPTION: If the reason is strongly face-related, trust it.
                    face_confirmation_keywords = [
                        "smiling", "smile", "expression", "glasses", "beard", "mustache", 
                        "human face", "person's face", "tilted head", "head angle", "profile view", 
                        "side-view", "side view", "partial face", "hairline", "forehead", "cheekbone",
                        "clearly visible features", "specific features", "face features"
                    ]
                    if any(kw in reason for kw in face_confirmation_keywords):
                        logger.info(f"[VLM] Trusting face despite 'none' landmarks because reason is strong: '{reason}'")
                    else:
                        logger.warning(f"[VLM] Overriding is_face=True -> False because NO landmarks were visible ('{landmarks}')")
                        is_face = False
                        reason = f"No landmarks visible ({reason})"
            
            # [Phase 56.8] Secondary Safeguards (Logic-based) Protection:
            # If VLM says it's a face but the reason mentions common false positives, override.
            if is_face is True:
                non_face_keywords = [
                    "hand", "finger", "shoulder", "knee", "elbow", "arm", "leg", "foot", 
                    "pattern", "object", "landscape", "body part", "body-part", "appendage", 
                    "hair", "fabric", "cloth", "skin patch", "skin-patch", "surface"
                ]
                if any(kw in reason for kw in non_face_keywords):
                    # Only override if "face" is NOT in the reason part describing the object.
                    if "face" not in reason:
                        logger.warning(f"[VLM] Overriding is_face=True -> False because reason mentioned non-face: '{reason}'")
                        is_face = False
            
            return {
                "is_face": is_face,
                "confidence": confidence,
                "reason": reason,
                "error": None
            }
        except (json.JSONDecodeError, ValueError, Exception) as e:
            # Fallback to old YES/NO parsing
            logger.debug(f"JSON parse failed for VLM response, falling back to heuristic: {e}")
            response_lower = response.lower()
            is_face = "yes" in response_lower[:10] or '"is_face": true' in response_lower
            confidence = 0.9 if is_face else 0.1
            reason = response.strip()
            
            return {
                "is_face": is_face,
                "confidence": confidence,
                "reason": reason,
                "error": None
            }
        
    except Exception as e:
        logger.error(f"VLM verification failed: {e}")
        return {
            "is_face": None,
            "confidence": 0.0,
            "reason": None,
            "error": str(e)
        }

