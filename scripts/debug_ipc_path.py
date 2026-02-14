
import sys
import subprocess
import json
import os

# Path to python executable
PYTHON_EXE = os.path.join(os.getcwd(), 'src', 'python', '.venv', 'Scripts', 'python.exe')
MAIN_SCRIPT = os.path.join(os.getcwd(), 'src', 'python', 'main.py')

def test_ipc():
    # The problematic path
    file_path = r"M:\SampleMediumSetPics\☆ Wink Wink ☆.jfif"
    
    # Construct a command payload as Electron would send it
    payload = {
        "command": "analyze_image",
        "payload": {
            "photoId": 9999,
            "filePath": file_path,
            "scanMode": "FAST",
            "enableVLM": False
        },
        "reqId": "test-req-1"
    }
    
    json_str = json.dumps(payload)
    print(f"Sending JSON: {json_str}")
    
    # Run main.py as a subprocess and pipe stdin
    # We explicitly do NOT set encoding to utf-8 here to see if default behavior fails
    process = subprocess.Popen(
        [PYTHON_EXE, MAIN_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True, 
        encoding='utf-8',
        bufsize=0 # Unbuffered 
    )
    
    try:
        stdout, stderr = process.communicate(input=json_str + "\n", timeout=10)
        
        print("STDOUT:", stdout)
        print("STDERR:", stderr)
        
        if "No such file or directory" in stderr or "Input/output error" in stderr:
            print("\n[FAIL] Reproduced 'No such file or directory' error!")
        elif "Image Load Failed" in stdout:
             print("\n[FAIL] Image Load Failed reported in JSON response.")
        else:
            print("\n[SUCCESS?] No obvious error found in output.")
            
    except subprocess.TimeoutExpired:
        process.kill()
        print("Timed out.")

if __name__ == "__main__":
    test_ipc()
