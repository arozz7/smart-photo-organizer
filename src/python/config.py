"""
Configuration constants for the AI engine.
"""
import os
import json
import logging

# [Phase 66] Centralized Config Loader
def load_ai_config():
    config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'ai-config.json'))
    defaults = {
         'segmentation': {
             'provider': 'sam3',
             'model_checkpoint': 'models/sam3.pt',
             'model_checkpoint_cpu': 'models/sam3_model.safetensors',
             'device': 'auto',
             'max_cached_sessions': 5,
         },
         'face_detection': {
             'score_threshold_strict': 0.60,
             'score_threshold_vlm_verification': 0.85, 
             'box_margin_percent': 0.10,
             'min_face_size_macro': 50,
             'det_thresh_macro': 0.30, # [Phase 90] Raised to 0.30 — eliminates texture/blur false positives
             'min_face_size_standard': 40,
             'face_blur_threshold': 15.0,
             'nms_iou_threshold': 0.45,
             'high_quality_face_threshold': 0.65
         },
         'vlm': {
             'enabled': False,
             'prompt_version': 'v1',
             'verification_threshold': 0.85,
             'forbidden_keywords': ["rock", "stone", "foliage", "ground", "clothing", "fabric", "balloon", "star", "decoration", "ornament", "toy", "metallic", "shiny", "reflective"],
             'forbidden_objects': ["knee", "hand", "glove", "hat", "cap", "camera", "microphone", "stone", "rock", "balloon", "star", "decoration", "ornament", "toy"]
         }
    }
    
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                loaded = json.load(f)
                # Shallow merge for now, can drive deeper if needed
                if 'segmentation' in loaded:
                    defaults['segmentation'].update(loaded['segmentation'])
                if 'face_detection' in loaded:
                    defaults['face_detection'].update(loaded['face_detection'])
                if 'vlm' in loaded:
                    defaults['vlm'].update(loaded['vlm'])
        except Exception as e:
            logging.getLogger('ai_engine.config').error(f"Failed to load ai-config.json: {e}")
            
    return defaults

AI_CONFIG = load_ai_config()

# Face Detection & Recognition
# Face Detection & Recognition
# VERIFICATION_THRESHOLD = 0.65  # Moved to Electron (ConfigService)
# SUSPECT_ENTITY_TYPE = 'suspect'
MAX_VERIFICATION_ATTEMPTS = 3  # Auto-ignore after this many failed VLM verifications

# VLM Settings
# [Non-face plan, Phase B part 2] The YES/NO question asked about a tight crop of every uncertain face; only the odds of the
# first word (NO against YES) are used, as a ranking signal. Measured on the user's reviewed labels (docs/measurements/
# non-face-and-picture-faces.md, section 8): this wording ranks as well as the one that also said "not the side of the head",
# and clearly better than wordings that spell out that turned faces count. Changing it means new weights in
# electron/core/services/visibilityModel.ts and a new VISIBILITY_MODEL name there.
FACE_VISIBILITY_PROMPT = (
    "Is there a clearly visible human face (eyes, nose and mouth, not only the back of the head, not hair, "
    "not an object) in the middle of this image? Answer with one word: YES or NO."
)

# [Pictures plan, Phase C] "Q1" of Phase A (docs/measurements/pictures.md): a real person, or only a picture of one? Only the odds of the
# first word (PICTURE against REAL) are used, as a ranking signal. Changing it means new weights in electron/core/services/pictureModel.ts
# and a new PICTURE_MODEL name there.
FACE_PICTURE_PROMPT = (
    "Look at the person in the middle of this image. Is this a real, living person who was physically there, or is it only a picture of a person "
    "(a framed photo, portrait, painting, poster, mural, TV or video screen)? Answer with one word: REAL or PICTURE."
)

# [Phase 58] Simplified prompt - semantic verification only (detector handles face counting)
# [Phase 82] Simplified Non-JSON Prompt (Robustness)
# [Phase 89.3] Added balloon/decoration warnings
VLM_VERIFICATION_PROMPT = """Analyze this image crop.
Determine if it contains a REAL HUMAN FACE.

OUTPUT STRICTLY IN THIS FORMAT:
IS_FACE: YES or NO
CONFIDENCE: 0.0 to 1.0
OBJECT: face, hand, rock, balloon, etc.
DESCRIPTION: Short visual description.

RULES:
1. If you see a HUMAN FACE (even if blurry, side view, or partially covered), output IS_FACE: YES.
2. If you see HANDS, KNEES, CLOTHING, ROCKS, BALLOONS, DECORATIONS, SHINY OBJECTS, or BACKGROUND TEXTURE, output IS_FACE: NO.
3. If you see MULTIPLE PEOPLE, output IS_FACE: YES.
4. BALLOONS, TOYS, ORNAMENTS, and REFLECTIVE SURFACES are NOT faces - output IS_FACE: NO.
5. Do NOT output markdown, JSON, or extra text.
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
