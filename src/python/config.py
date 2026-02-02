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
1. Identify physical landmarks: Do you see any facial features? You MUST find specific parts like an eye, nose, mouth, chin, or ear.
   (Faces may be TILTED or at UNUSUAL ANGLES in macro shots. If you see a face, name the most likely features.)
2. Distinguish from body parts: Is it a hand, shoulder, knee, or just a patch of skin?
   CRITICAL: A smooth patch of well-lit skin with no features is NOT a face.
3. Final Decision: Is it a face?

RESPOND IN JSON:
{
  "landmarks_visible": "list specific parts seen or 'none'",
  "is_face": true|false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation (avoid generic phrases like 'clear and well-lit')"
}

CRITICAL: If you ONLY see hair, skin with no features, or a hand, "is_face" must be FALSE.
Note: If you recognize a smile or expression, identify the mouth as visible.
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
