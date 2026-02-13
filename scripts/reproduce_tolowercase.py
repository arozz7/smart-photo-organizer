
import json
import re

def test_cleaning():
    raw_response = """{
    "category": "face",
    "specific_object": null,
    "is_face": true,
    "confidence": 0.976833333,
    "description": "Some Description".toLowerCase()
}"""
    
    print(f"Original:\n{raw_response}")
    
    # Simulate current logic (fails)
    try:
        json.loads(raw_response)
        print("SUCCESS (Clean)")
    except Exception as e:
        print(f"FAILED (Clean): {e}")

    # Aggressive cleaning (Proposed Fix)
    # Remove .toLowerCase() and .toUpperCase() pattern
    cleaned = raw_response.replace(".toLowerCase()", "").replace(".toUpperCase()", "")
    
    print(f"\nCleaned:\n{cleaned}")
    try:
        json.loads(cleaned)
        print("SUCCESS (Fixed)")
    except Exception as e:
        print(f"FAILED (Fixed): {e}")

if __name__ == "__main__":
    test_cleaning()
