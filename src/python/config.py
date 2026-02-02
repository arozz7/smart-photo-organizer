"""
Configuration constants for the AI engine.
"""

# Face Detection & Recognition
VERIFICATION_THRESHOLD = 0.45  # Faces below this score are marked as 'suspect'
SUSPECT_ENTITY_TYPE = 'suspect'
MAX_VERIFICATION_ATTEMPTS = 3  # Auto-ignore after this many failed VLM verifications

# VLM Settings
# [Phase 58] Simplified prompt - semantic verification only (detector handles face counting)
VLM_VERIFICATION_PROMPT = """Analyze this cropped image region and determine if it shows a human face.

CRITICAL: In this context, a "human face" is a specific category. Appendages (hand, elbow, knee, shoulder, back of head) are "body parts" but are NOT faces. 

If the image shows a face, even partially, you MUST respond with "is_face": true and "reason": "human face".
If the image shows a hand, knee, or other appendage but NO face, you MUST respond with "is_face": false and "reason": "body part".

Answer these questions:
1. Is this a human face? (yes/no)
2. If not a face, what specifically is it? (e.g., shoulder, knee, elbow, hand, pattern, object, body part, hair)

Respond in JSON format:
{
  "is_face": true|false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Note: Focus on semantic classification only. Do NOT attempt to count faces."""

# [Phase 59] AdaFace Configuration
# AdaFace is used for improved recognition on low-quality (blurry) faces
ADAFACE_ENABLED = True  # Enable/disable AdaFace hybrid embedding
ADAFACE_BLUR_THRESHOLD = 50  # Use AdaFace if blur_score < this value (0-100 scale)
ADAFACE_MODEL_PATH = "models/adaface_ir50_webface4m.onnx"  # Path to ONNX model
