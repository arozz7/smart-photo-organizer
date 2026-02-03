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

Analyze the image. You are a quality control agent catching ERRORS from an automated face detector.
The detector often makes mistakes and detects hands, knees, shoulders, and skin patches as faces.

YOUR TASK:
Determine if the object in the absolute CENTER is a REAL HUMAN FACE or a FALSE POSITIVE (skin, body part, clothing, or hair).

1. Categorize: "face" or "false_positive"
2. Describe: What exactly do you see? If it's skin, describe texture/grain. If it's a face, list specific visible parts.

Output ONLY JSON:
{
  "category": "face | false_positive",
  "specific_object": "e.g. skin_patch, knee, arm, human_face",
  "is_face": false,
  "confidence": 0.0,
  "description": "be honest and skeptical"
}
"""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
