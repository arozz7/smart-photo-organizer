
import json
import logging

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("test_vlm_repair")

def test_repair(malformed_json):
    print(f"\n--- Testing: {malformed_json} ---")
    clean_response = malformed_json
    max_json_retries = 3
    parsed = {}
    json_error = None
    
    for attempt in range(max_json_retries + 1):
        try:
            parsed = json.loads(clean_response)
            json_error = None
            print(f"SUCCESS (Attempt {attempt}): {parsed}")
            break # Success!
        except json.JSONDecodeError as e:
            json_error = e
            if attempt == max_json_retries:
                print(f"FAILED after max retries: {e}")
                break # Give up after max retries
            
            print(f"Error (Attempt {attempt}): {e.msg} at pos {e.pos}")
            
            # REPAIR STRATEGIES (Copied from vlm.py)
            # 1. Expecting ',' delimiter (missing comma)
            if "Expecting ',' delimiter" in e.msg:
                head = clean_response[:e.pos]
                tail = clean_response[e.pos:]
                clean_response = head + "," + tail
                print(f"Repaired: Inserted comma at {e.pos}")
                
            # 2. Expecting property name enclosed in double quotes (missing quotes on key)
            elif "Expecting property name" in e.msg:
                colon_idx = clean_response.find(":", e.pos)
                if colon_idx != -1:
                    key_text = clean_response[e.pos:colon_idx].strip()
                    head = clean_response[:e.pos]
                    tail = clean_response[colon_idx:]
                    clean_response = head + '"' + key_text + '"' + tail
                    print(f"Repaired: Quoted key '{key_text}'")
                else:
                        break # Cannot repair
                        
            # 3. Unterminated string (truncated)
            elif "Unterminated string" in e.msg:
                    clean_response = clean_response.rstrip().rstrip(",")
                    if not clean_response.strip().endswith('"'):
                        clean_response += '"'
                    clean_response += "}"
                    print("Repaired: Closed unterminated string")
                    
            else:
                print(f"Unknown error: {e.msg}")
                break

if __name__ == "__main__":
    # Case 1: Missing comma
    test_repair('{"is_face": true "confidence": 0.9}')
    
    # Case 2: Missing quotes on key
    test_repair('{"is_face": true, confidence: 0.9}')
    
    # Case 3: Truncated
    test_repair('{"is_face": true, "confid')
    
    # Case 4: Multiple missing commas
    test_repair('{"a": 1 "b": 2 "c": 3}')
