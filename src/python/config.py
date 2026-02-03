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
1. Categorize: Is the object in the absolute center a HUMAN FACE, or is it a BODY PART (knee, shoulder, elbow, arm, leg, foot, or just a patch of skin)?
2. Evidence: What specific anatomical features are visible? If it's a skin patch, describe the texture (smooth, skin grain, fabric).
3. Decision: Assign "is_face": true ONLY if it is a clear human face.

RESPOND IN JSON:
{
  "object_type": "face | knee | shoulder | skin_patch | other",
  "is_face": boolean,
  "confidence": 0.99,
  "landmarks": "list 2+ parts if face, or 'none'",
  "reason": "be specific and honest"
}

CRITICAL: If it is a smooth patch of skin or just hair, is_face MUST be false. Do not hallucinate features that are not clearly visible.
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
