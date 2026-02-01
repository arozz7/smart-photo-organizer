"""
Configuration constants for the AI engine.
"""

# Face Detection & Recognition
VERIFICATION_THRESHOLD = 0.45  # Faces below this score are marked as 'suspect'
SUSPECT_ENTITY_TYPE = 'suspect'
MAX_VERIFICATION_ATTEMPTS = 3  # Auto-ignore after this many failed VLM verifications

# VLM Settings
# [Phase 57] Enhanced prompt to detect multi-face boxes and false positives
VLM_VERIFICATION_PROMPT = """You are analyzing a CROPPED REGION from a photo. Count ONLY the faces that are COMPLETELY or MOSTLY visible within THIS EXACT REGION.

Answer these questions:
1. How many COMPLETE human faces are in this region? (Count carefully - if you see 2 faces, say "multiple")
2. Is this region showing a human face/faces? (yes/no)
3. If not a face, what is it? (e.g., shoulder, knee, object, body part)

IMPORTANT: If you see TWO people or TWO faces in this region, you MUST set face_count to "multiple".

Respond in JSON format:
{
  "face_count": "one|multiple|none",
  "is_face": true|false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}"""
