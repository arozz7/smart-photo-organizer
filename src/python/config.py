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
1. Identify physical landmarks: Do you see an eye, a nose, OR a mouth?
2. Distinguish from body parts: Is it a hand, shoulder, elbow, or just hair?
3. Final Decision: Is it a face?

RESPOND IN JSON:
{
  "landmarks_visible": "list what you see (e.g. eye, nose, mouth) or 'none'",
  "is_face": true|false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

CRITICAL: If you ONLY see hair, skin with no features, or a hand, "is_face" must be FALSE."""

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
