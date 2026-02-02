"""
Configuration constants for the AI engine.
"""

# Face Detection & Recognition
VERIFICATION_THRESHOLD = 0.45  # Faces below this score are marked as 'suspect'
SUSPECT_ENTITY_TYPE = 'suspect'
MAX_VERIFICATION_ATTEMPTS = 3  # Auto-ignore after this many failed VLM verifications

# VLM Settings
# [Phase 58] Simplified prompt - semantic verification only (detector handles face counting)
VLM_VERIFICATION_PROMPT = """Analyze the object in the CENTER of this cropped image.

CRITICAL: Is the object exactly in the center of this image a human face? 
A "human face" must show clear eyes, nose, or mouth. 

DO NOT classify hair, headpieces, shoulders, or hands as a face. 
Ignore any other faces that might appear on the edges of this crop; focus ONLY on the center.

If the center object is a face, respond with "is_face": true and "reason": "human face".
If the center object is hair, a headpiece, or a blank area, respond with "is_face": false and "reason": "hair" or "object".

Answer these questions:
1. Is the object in the center a human face? (yes/no)
2. If not a face, what specifically is it? (e.g., hair, headpiece, shoulder, hand, empty space)

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
