import sys
import logging
from PIL import Image, ImageOps
import rawpy

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
             if len(clean) > 3 and clean not in stopwords:
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

    return description, tags
