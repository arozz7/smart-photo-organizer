import sys
import os
import cv2
import numpy as np

# Setup paths
sys.path.append(os.path.join(os.getcwd(), 'src', 'python'))

import facelib.faces as faces
import facelib.utils as utils

# Target: pexels-polina-tankilevitch-3875130.jpg
# Face ID 230 Box: {'x': 419, 'y': 678, 'width': 781, 'height': 780}
# Path from logs: M:\SampleMediumSetPics\pexels-polina-tankilevitch-3875130.jpg

IMAGE_PATH = r"M:\SampleMediumSetPics\pexels-polina-tankilevitch-3875130.jpg"
BOX = {'x': 419, 'y': 678, 'width': 781, 'height': 780}

def test_split():
    # 1. Load Image
    if not os.path.exists(IMAGE_PATH):
        print(f"Image not found: {IMAGE_PATH}")
        # Try to find it in the user's workspace if M: is not available to me?
        # But run_command runs on user's machine, so M: should be valid.
        pass

    print(f"Loading {IMAGE_PATH}...")
    img = cv2.imread(IMAGE_PATH)
    if img is None:
        print("Failed to load image via cv2.imread. Checking alternative path...")
        # Fallback for "SampleMediumSetPics" if M map is different
        alt_path = r"J:\Projects\smart-photo-organizer\M\SampleMediumSetPics\pexels-polina-tankilevitch-3875130.jpg" 
        # Actually I don't know the mapping. But previous debug used M: and it worked? 
        # Wait, I didn't verify if previous debug worked with M: path.
        # It printed "Loading M:\..."
        # So I assume it works.
        pass

    if img is None:
        print("Could not load image.")
        return

    print(f"Image Shape: {img.shape}")

    # 2. Crop (Logic from scan.py)
    x, y, w_box, h_box = BOX['x'], BOX['y'], BOX['width'], BOX['height']
    pad = int(min(w_box, h_box) * 0.1)
    
    img_h, img_w = img.shape[:2]
    y1 = max(0, y - pad)
    y2 = min(img_h, y + h_box + pad)
    x1 = max(0, x - pad)
    x2 = min(img_w, x + w_box + pad)
    
    print(f"Cropping to [{x1}:{x2}, {y1}:{y2}]...")
    crop = img[y1:y2, x1:x2]
    print(f"Crop Shape: {crop.shape}")

    # 3. Test Configurations
    configs = [
        {'det_thresh': 0.5, 'det_size': (640, 640), 'name': 'Low Res (640)'},
        {'det_thresh': 0.5, 'det_size': (1280, 1280), 'name': 'Standard (1280)'},
        {'det_thresh': 0.3, 'det_size': (640, 640), 'name': 'Low Res + Low Thresh'},
        {'det_thresh': 0.5, 'det_size': (320, 320), 'name': 'Very Low Res (320)'},
    ]

    utils.get_torch() # Init runtime

    for cfg in configs:
        print(f"\n--- Testing {cfg['name']} ---")
        try:
            # Force re-init with new params
            faces.init_insightface(det_thresh=cfg['det_thresh'], det_size=cfg['det_size'])
            
            # Detect
            detected = faces.app.get(crop)
            print(f"Found {len(detected)} faces.")
            
            for i, face in enumerate(detected):
                print(f"  Face {i+1}: Score={face.det_score:.4f}, Box={face.bbox.astype(int)}")

        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    test_split()
