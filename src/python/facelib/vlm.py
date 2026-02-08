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
            
            # [Phase 56.9.1] Round 6 Adrien-Skeptical Fields
            category = str(parsed.get('category', 'face')).lower()
            obj_type = str(parsed.get('specific_object', parsed.get('object_type', 'face'))).lower()
            is_face = parsed.get('is_face', False)
            confidence = float(parsed.get('confidence', 0.5))
            
            # landmarks and reason may drift names in adversarial mode
            landmarks = str(parsed.get('landmarks', parsed.get('landmarks_visible', ''))).lower()
            reason = str(parsed.get('description', parsed.get('reason', ''))).lower()
            
            # [Phase 58.1] Append specific_object to reason
            # If description is "beautiful" but specific_object is "human face", we want to count that as proof.
            if obj_type and obj_type not in reason:
                reason += f" (object: {obj_type})"
            
            # [Phase 56.9.1] HARD CATEGORY OVERRIDE
            from config import AI_CONFIG
            
            # Use centralized config for rejection lists
            non_face_categories = ["false_positive", "false-positive", "skin", "body", "fabric", "background", "clothing"]
            
            # Objects that are definitely NOT faces (even if VLM is confused)
            # Default to hardcoded safe list if config missing
            non_face_objs = AI_CONFIG.get('vlm', {}).get('forbidden_objects', [
                "knee", "shoulder", "skin_patch", "arm", "leg", "elbow", "foot", "body_part", "hand", "finger", 
                "hat", "cap", "camera", "microphone" # Added from Phase 67 analysis
            ])
            
            is_categorized_non_face = any(c in category for c in non_face_categories) or any(o in obj_type for o in non_face_objs)
            
            if is_face is True and is_categorized_non_face:
                logger.warning(f"[VLM] Categorized as {category}/{obj_type}. Forcing is_face=False.")
                is_face = False
                reason = f"Categorized as {category}/{obj_type} ({reason})"

            # [Phase 56.9] AGGRESSIVE ECHO STRIPPING
            # Remove any text that echoes the prompt instructions.
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
            
            # [Phase 56.9] MANDATORY ANATOMICAL CHECK
            # CRITICAL: Only trust the natural language description/reason for anatomical parts.
            # JSON keys and coordinates are too easy for models to hallucinate/parrot.
            anatomical_terms = [
                "eye", "nose", "mouth", "lip", "chin", "ear", "eyebrow", "cheek", 
                "forehead", "hairline", "profile", "smile", "nostril", "eyelid"
            ]
            
            # [Phase 57.1] STRICT WORD BOUNDARY MATCHING
            # Fixes bug where "perfectly clear" matched "ear".
            import re
            def has_word(text, terms):
                for term in terms:
                    # Match whole words only, case insensitive
                    if re.search(r'\b' + re.escape(term) + r'\b', text, re.IGNORECASE):
                        # [Debug] Log what matched
                        logger.info(f"[VLM Debug] Matched keyword: '{term}' in '{text}'")
                        return True
                return False

            has_anatomical = has_word(reason, anatomical_terms)
            
            # [Phase 56.5] LANDMARK VALIDATION
            # If the model says it's a face but provides NO anatomical proof in text.
            if is_face is True:
                # [Phase 57.0] REMOVED CONFIDENCE BYPASS
                # The VLM hallucinated 0.99999+ confidence for knees. 
                # We can no longer trust confidence alone. 
                # Proof must exist in the description.

                # Specific proof keywords
                # [Phase 66] HARDENED VOCABULARY
                # Removed "face", "person", "human being" to force anatomical/demographic specificity.
                # A box must be described as a specific GENDER (man/woman) or have FEATURES (smile/glasses)
                # to be trusted. "It is a face" is no longer enough.
                face_proof = [
                    "smiling", "smile", "expression", "glasses", "beard", "mustache", 
                    "tilted head", "head angle", "profile view", 
                    "side-view", "side view", 
                    # Singular forms
                    "girl", "boy", "man", "woman", "child", "baby", "lady", "gentleman",
                    "bride", "groom", "infant", "toddler", "couple",
                    # [Phase 75 Fix] Plural forms - VLM often says "two men", "women", etc.
                    "men", "women", "children", "people", "adults", "faces"
                ]
                
                if has_anatomical or has_word(reason, face_proof):
                    logger.info(f"[VLM] Trusting face: Evidence found in description.")
                else:
                    logger.warning(f"[VLM] Overriding is_face=True -> False because NO anatomical proof was found in text (Confidence: {confidence:.4f}).")
                    is_face = False
                    reason = f"No anatomical proof in description (reason: {reason})"
            
            # [Phase 56.9] Secondary Safeguards (Hard Rejections)
            if is_face is True:
                # [Fix] Removed "hair", "fabric", "cloth", "shoulder" - too common in valid descriptions
                # [Refinement] Removed abstract terms like "object", "pattern", "surface" which cause false positives.
                # [Phase 66] Expanded Blacklist based on User Feedback ("Chair legs", "Pants", "Floor")
                # Loaded from Central Config
                non_face_keywords = AI_CONFIG.get('vlm', {}).get('forbidden_keywords', [
                    "knee", "elbow", "arm", "leg", "foot",
                    "chair", "furniture", "wood", "floor", "ground", "pants", "jeans", "shirt", "clothing", "fabric",
                    "rock", "stone", "concrete", "pavement", "foliage", "leaf", "plant", "grass", "tree"
                ])
                
                # [Refinement] Removed is_person bypass. 
                # It was too risky ("woman's hand" would pass).
                # Instead, we rely on the strictly reduced blacklist above.
                
                # [Phase 66.5] Safety: Allow clothing/furniture terms IF a Person is clearly identified.
                # "happy man in a blue shirt" -> KEEP (has 'man')
                # "blue shirt on the floor"   -> REJECT (no 'man')
                person_indicators = ["face", "man", "woman", "boy", "girl", "baby", "person", "child", "men", "women", "people"]
                
                for kw in non_face_keywords:
                    if kw in reason:
                        # Only override if NO person-indicators are present.
                        if not any(p in reason for p in person_indicators):
                            logger.warning(f"[VLM] Overriding is_face=True -> False because reason mentioned non-face keyword '{kw}': '{reason}'")
                            is_face = False
                            break
            
            # [Phase 63.5] Generic Hallucination Filter (Replaces Phase 63)
            # Problem: "Hand" box gets generic description "the woman's face is visible".
            # Problem: "Dress" box gets detailed description "pink sparkly dress".
            # Fix: Reject GENERIC descriptions. Keep DETAILED ones (even if they talk about clothes).
            if is_face is True:
                # Terms that indicate the VLM is just stating "it's a face" without seeing details.
                # These are common hallucinations for non-face objects.
                # [Phase 66] Removed "human face" from generic list.
                generic_phrases = [
                    "face is visible", "the object is a face", 
                    "facial features are visible", "person's face", "a face",
                    "visible face", "human head", "the image contains a face",
                    "close-up of a face"
                ]
                
                # [Debug] Check if the reason is TOO SHORT or TOO GENERIC.
                # 1. Clean up reason (lowercase, remove punctuation)
                clean_reason = reason.lower().strip().strip(".").strip()
                
                # 2. Exact match on generic phrases (or extremely close)
                is_generic = any(clean_reason == gp or clean_reason == f"a {gp}" or clean_reason == f"the {gp}" for gp in generic_phrases)
                
                # 3. Contains generic phrase AND is short
                if not is_generic:
                     for gp in generic_phrases:
                         if gp in clean_reason and len(clean_reason) < 45: 
                             is_generic = True
                             logger.info(f"[VLM Debug] Generic Match Found: '{gp}' in '{clean_reason}'")
                             break
                
                if is_generic:
                    # BUT wait! Does it have specific details?
                    # If it mentions color or specific hair/clothing/type, it might be real.
                    details = [
                        "pink", "blue", "red", "green", "hair", " dress", "shirt", "eyes", "nose", "mouth", "smile", "looking",
                        "woman", "man", "boy", "girl", "baby", "child", "person", "lady", "gentleman",
                        "bride", "groom", "infant", "toddler", "couple", "people", "portrait",
                        "beautiful", "pretty", "human", "mask", "costume", "makeup", # [Phase 66] Added human/mask/costume
                        "men", "women", "adults", "faces" # [Phase 75 Fix] Plural forms
                    ]
                    # [Fix] Use strict word matching to prevent "human" -> "man" substring match
                    has_detail = has_word(clean_reason, details)
                    if has_detail:
                         logger.info(f"[VLM] Generic description ('{clean_reason}') SAVED by specific detail.")
                         is_generic = False # Override
                    else:
                         logger.warning(f"[VLM] Generic description ('{clean_reason}') REJECTED (No details).")
                    
                    logger.info(f"[VLM Debug] Filter Check: '{clean_reason}' | Valid? {has_detail} | Generic? {is_generic}")

                    
                    if not has_detail:
                        logger.warning(f"[VLM] Overriding is_face=True -> False. Reason is too generic ('{reason}') and lacks specific details.")
                        is_face = False
                        reason = f"Generic Hallucination Detected (reason: {reason})"
            
            # [Phase 68] Extract Suggested Metadata (Gender/Age)
            # Use VLM's semantic understanding to correct InsightFace's statistical guesses.
            suggested_metadata = {}
            
            # Combine reason and specific object for mining
            mining_text = (str(reason) + " " + str(obj_type)).lower()
            
            # Gender Extraction
            if any(w in mining_text for w in ["woman", "girl", "lady", "bride", "mother", "female"]):
                suggested_metadata['gender'] = "F"
            elif any(w in mining_text for w in ["man", "boy", "gentleman", "groom", "father", "male"]):
                suggested_metadata['gender'] = "M"
                
            # Age Extraction (Rough Approximation)
            if any(w in mining_text for w in ["baby", "infant", "toddler"]):
                suggested_metadata['age'] = 2
            elif any(w in mining_text for w in ["child", "kid", "boy", "girl"]):
                # Only override if we don't think it's an adult
                if "woman" not in mining_text and "man" not in mining_text:
                    suggested_metadata['age'] = 10
            # [Phase 68] Multi-Face Detection (Split Logic)
            # If the description mentions multiple people, flag it so FaceService can split the box.
            multi_face_terms = ["two", "couple", "group", "multiple", "heads together", "three", "pair", "men", "women"]
            
            # Helper for parent/child detection
            parents = ["woman", "man", "mother", "father", "lady", "gentleman"]
            children = ["baby", "child", "infant", "toddler", "kid", "boy", "girl"]
            has_parent = has_word(mining_text, parents)
            has_child = has_word(mining_text, children)

            if has_word(mining_text, multi_face_terms) or (has_parent and has_child):
                 suggested_metadata['is_multi_face'] = True
                 logger.info(f"[VLM] Multi-Face Detected: '{reason}'. Flagging for split.")

            elif any(w in mining_text for w in ["adult", "woman", "man", "elderly", "senior"]):
                suggested_metadata['age'] = 30 # Generic adult
            
            
            logger.info(f"[VLM] Returning result with metadata: {suggested_metadata}")
            return {
                "is_face": is_face,
                "confidence": confidence,
                "reason": reason,
                "suggested_metadata": suggested_metadata,
                "error": None
            }
        except (json.JSONDecodeError, ValueError, Exception) as e:
            import traceback
            traceback.print_exc()
            # Fallback to old YES/NO parsing
            logger.debug(f"JSON parse failed for VLM response, falling back to heuristic: {e}")
            response_lower = response.lower()
            is_face = "yes" in response_lower[:10] or '"is_face": true' in response_lower
            confidence = 0.9 if is_face else 0.1
            reason = response.strip()
            
            # Use Fallback Metadata extraction?
            suggested_metadata = {} 
            # (We could duplicate logic here but for now just empty)

            return {
                "is_face": is_face,
                "confidence": confidence,
                "reason": reason,
                "suggested_metadata": suggested_metadata,
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

