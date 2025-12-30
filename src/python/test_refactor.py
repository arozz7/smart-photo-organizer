import sys
import os
import numpy as np

# Add src/python to path
sys.path.append(os.path.join(os.getcwd(), 'src', 'python'))

def test_imports():
    print("Testing imports...")
    try:
        from facelib import utils, image_ops, faces, vlm, vector_store
        print("✅ Imports successful.")
        return True
    except Exception as e:
        print(f"❌ Import failed: {e}")
        return False

def test_image_ops():
    print("Testing image_ops...")
    from facelib import image_ops
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    blur = image_ops.estimate_blur(img)
    print(f"✅ estimate_blur result: {blur}")
    
    bbox = [10, 10, 50, 50]
    expanded = image_ops.expand_box(bbox, 100, 100)
    print(f"✅ expand_box result: {expanded}")

def test_main_ping():
    print("Testing main.py ping command...")
    import main
    
    cmd = {"type": "ping", "payload": {}}
    response = main.handle_command(cmd)
    print(f"Ping Response: {response}")
    
    if response['type'] == 'pong':
        print("✅ Ping successful.")
    else:
        print("❌ Ping failed.")

if __name__ == '__main__':
    if test_imports():
        test_image_ops()
        test_main_ping()
        print("\nVerification Complete.")
