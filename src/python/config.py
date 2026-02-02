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

To verify if this is a HUMAN FACE, follow these steps:
1. Identify physical landmarks: You MUST find specific facial features like eyes, nose, mouth, chin, or ears.
   (If it is a tilted face in a macro shot, name the features you see.)
2. Distinguish from body parts: Is it a hand, shoulder, knee, or a patch of skin/hair?
   CRITICAL: A smooth patch of skin or just hair is NOT a face.
3. Final Decision: Is it a face?

RESPOND IN JSON:
{
  "is_face": true,
  "confidence": 0.99,
  "landmarks_visible": "list 2+ specific facial parts seen",
  "reason": "short explanation (be specific)"
}

CRITICAL: If you ONLY see hair, skin with no features, or a hand, "is_face" must be FALSE.
Note: If you recognize a smile or expression, identify the mouth as visible.
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
