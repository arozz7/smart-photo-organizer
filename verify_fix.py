import subprocess
import json
import sys
import os
import time
import threading
import queue

def enqueue_output(out, q, name):
    for line in iter(out.readline, ''):
        q.put((name, line))
    out.close()

def run_test():
    # Path to python environment and script
    python_exe = os.path.join("src", "python", ".venv", "Scripts", "python.exe")
    script_path = os.path.join("src", "python", "main.py")
    
    # Test Image Path (Use the one uploaded by the user)
    image_path = "C:/Users/arozz/.gemini/antigravity/brain/4e1c7e64-cd7e-4fd0-8789-fca9f9fba93a/uploaded_image_1765662110587.png"
    
    if not os.path.exists(python_exe):
        print(f"Python executable not found at {python_exe}")
        return

    if not os.path.exists(image_path):
        print(f"Warning: Test image not found at {image_path}. Please check the path.")

    print(f"Starting Python backend: {python_exe} {script_path}")
    process = subprocess.Popen(
        [python_exe, script_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=os.getcwd(),
        env={**os.environ, "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"},
        bufsize=1 # Line buffered
    )

    # Use queues to read stdout/stderr non-blocking
    q = queue.Queue()
    t_out = threading.Thread(target=enqueue_output, args=(process.stdout, q, 'STDOUT'))
    t_err = threading.Thread(target=enqueue_output, args=(process.stderr, q, 'STDERR'))
    t_out.daemon = True
    t_err.daemon = True
    t_out.start()
    t_err.start()

    # Wait for init cues or just sleep
    print("Waiting for initialization...")
    
    init_done = False
    start_wait = time.time()
    
    # We won't strictly wait for a specific log line because buffering might delay it
    # But we will monitor the queue
    
    command_sent = False
    
    while True:
        try:
            # Non-blocking read from queue
            name, line = q.get_nowait()
            line = line.strip()
            if line:
                print(f"[{name}] {line}")
                
            if name == 'STDOUT' and line.startswith('{'):
                # Process Response
                try:
                    response = json.loads(line)
                    if response.get("type") == "scan_result":
                        print("\nSUCCESS: Received Scan Result!")
                        faces = response.get("faces", [])
                        print(f"Found {len(faces)} faces.")
                        for i, face in enumerate(faces):
                            print(f"  Face {i+1}: Box {face['box']}")
                        # We are done
                        process.terminate()
                        return
                except:
                    pass
        except queue.Empty:
            # No output
            pass
            
        # Send command after a few seconds if not sent
        if not command_sent and (time.time() - start_wait > 5):
            print("\nSending Command with DEBUG=True...")
            command = {
                "type": "scan_image", 
                "payload": {
                    "photoId": 999, 
                    "filePath": image_path,
                    "debug": True,
                    "debugOutputPath": "debug_detected_faces.jpg"
                }
            }
            process.stdin.write(json.dumps(command) + "\n")
            process.stdin.flush()
            command_sent = True
            
        # Timeout
        if time.time() - start_wait > 60:
            print("Timed out.")
            process.terminate()
            break
            
        time.sleep(0.1)

if __name__ == "__main__":
    run_test()
