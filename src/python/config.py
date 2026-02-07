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
         'face_detection': {
             'score_threshold_strict': 0.60,
             'score_threshold_vlm_verification': 0.85, 
             'box_margin_percent': 0.10,
             'min_face_size_macro': 50,
             'min_face_size_standard': 40,
             'face_blur_threshold': 15.0
         },
         'vlm': {
             'enabled': False,
             'prompt_version': 'v1',
             'verification_threshold': 0.85,
             'forbidden_keywords': ["rock", "stone", "foliage", "ground", "clothing", "fabric"],
             'forbidden_objects': ["knee", "hand", "glove", "hat", "cap", "camera", "microphone", "stone", "rock"]
         }
    }
    
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                loaded = json.load(f)
                # Shallow merge for now, can drive deeper if needed
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
# [Phase 58] Simplified prompt - semantic verification only (detector handles face counting)
VLM_VERIFICATION_PROMPT = """Analyze this image.

Analyze the image. You are a quality control agent catching ERRORS from an automated face detector.
The detector often makes mistakes and detects hands, knees, shoulders, skin patches, ROCKS, LEAVES, and GROUND TEXTURES as faces.

YOUR TASK:
Determine if this image crop contains a REAL HUMAN FACE or a FALSE POSITIVE.
Also check for MULTIPLE PEOPLE merged into this single crop.

1. Categorize: "face" or "false_positive"
2. Describe: What exactly do you see? If it's a face, list visible parts. If it is MULTIPLE PEOPLE, describe them (e.g. "Woman holding a baby").
3. BE SPECIFIC: Do NOT just say "human face". Specify gender (man/woman) and age (child/adult).
4. FALSE POSITIVE CHECK: If you see fabric, clothing (pants, shirt texture), furniture (chair legs), ground/floor patterns, rocks, stones, or foliage, mark as "false_positive".
6. MULTI-FACE CHECK: If the center object is actually TWO OR MORE PEOPLE (e.g. a couple, a group, a woman holding a baby), explicitlly mention "multiple people" or "two faces" in the description.
7. IMPORTANT: Faces with medical masks, costumes, or heavy makeup ARE VALID FACES. Do not mark them as false_positive just because they are covered.

Output ONLY JSON:
{
  "category": "face",
  "specific_object": "object_name",
  "is_face": false,
  "confidence": 0.0,
  "description": "visual description"
}
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
