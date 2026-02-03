"""
Configuration constants for the AI engine.
"""

# Face Detection & Recognition
VERIFICATION_THRESHOLD = 0.45  # Faces below this score are marked as 'suspect'
SUSPECT_ENTITY_TYPE = 'suspect'
MAX_VERIFICATION_ATTEMPTS = 3  # Auto-ignore after this many failed VLM verifications

# VLM Settings
# [Phase 58] Simplified prompt - semantic verification only (detector handles face counting)
VLM_VERIFICATION_PROMPT = """Analyze the object in the absolute CENTER of this image.

Analyze the image and determine if the object in the absolute CENTER is a human face.

INSTRUCTIONS:
- Identify if it is a HUMAN FACE or a BODY PART (knee, elbow, arm, skin patch, etc).
- List the specific facial landmarks you see (eyes, nose, mouth, ears, profile, etc).
- If it is a smooth patch of skin or a knee, assign is_face: false.

Output valid JSON with these fields:
{
  "object_type": "",
  "is_face": false,
  "confidence": 0.0,
  "landmarks": "",
  "reason": ""
}
(object_type should be "face", "knee", "elbow", "skin_patch", etc.)
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
