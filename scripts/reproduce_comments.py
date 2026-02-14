
import json
import re

def test_comment_stripping():
    raw_response = """{
    "category": "face",
    "specific_object": null,   //if no specific object was found...
    "is_face": true,      //this will be checked first...
    "confidence": 0.9,     //the confidence score...
    "description": "Some description."
}"""
    
    print(f"Original:\n{raw_response}")
    
    # Current Fix Logic
    clean_response = raw_response
    clean_response = re.sub(r'//.*?(?=\n|$)', '', clean_response, flags=re.MULTILINE)
    
    print(f"\nCleaned:\n{clean_response}")
    
    try:
        json.loads(clean_response)
        print("SUCCESS (Parsed)")
    except Exception as e:
        print(f"FAILED (Parse): {e}")

if __name__ == "__main__":
    test_comment_stripping()
