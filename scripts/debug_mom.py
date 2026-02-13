
import sys
import os
import cv2
import numpy as np
import logging

# Configure logging to stdout
logging.basicConfig(level=logging.INFO, format='%(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('debug_mom')

# Add src/python to path
sys.path.append(os.path.join(os.getcwd(), 'src', 'python'))

import facelib.detector as detector_module
import facelib.nms as nms
import facelib.vlm as vlm

def load_image_cv2(file_path):
    print(f"Loading {file_path}...")
    try:
        from PIL import Image, ImageOps as PILImageOps
        pil_img = Image.open(file_path)
        pil_img = PILImageOps.exif_transpose(pil_img)
        rgb_img = np.array(pil_img)
        img = cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)
        print(f"Loaded successfully. Shape: {img.shape}")
        return img
    except Exception as e:
        print(f"Error loading image: {e}")
        return None

def debug():
    file_path = r"M:\SampleMediumSetPics\mom_daughter.jfif"
    output_file = "debug_mom_output.txt"
    
    with open(output_file, "w", encoding="utf-8") as f:
        def log(msg):
            print(msg)
            f.write(msg + "\n")

        if not os.path.exists(file_path):
            log(f"ERROR: File not found at {file_path}")
            return

        img = load_image_cv2(file_path)
        if img is None:
            return

        # Use CONFIG from user's environment
        # The logs showed detThreshStandard: 0.6, detThreshMacro: 0.3
        config = {
            'detThreshStandard': 0.1,  # [DEBUG] Lowered
            'detThreshMacro': 0.1, 
            'nmsIouThresh': 0.45,
            'enableTTA': True,        # [DEBUG] ENABLE TTA
            'enableMacroLowRes': True
        }

        log("\n--- 1. Running FaceDetector ---")
        detector = detector_module.FaceDetector(config)
        # Switch to MACRO to utilize detThreshMacro (0.1) and lower NMS thresholds
        scan_results = detector.detect(img, scan_mode='MACRO') 
        
        log(f"Detector found {len(scan_results)} candidates.")
        for i, face in enumerate(scan_results):
            log(f"  [{i}] Box: {face['box']}, Score: {face.get('score', 0):.4f}, Quality: {face.get('faceQuality', 0):.4f}")

        log("\n--- 2. Running NMS ---")
        final_faces = nms.resolve_conflicts(scan_results, config)
        log(f"NMS found {len(final_faces)} unique faces.")
        
        for i, face in enumerate(final_faces):
            log(f"  [{i}] Box: {face['box']}, Score: {face.get('score', 0):.4f}")
            
        log("\n--- 3. Running VLM Verification ---")
        for i, face in enumerate(final_faces):
            log(f"Verifying Face {i}...")
            box_dict = {
                'x1': face['box']['x'],
                'y1': face['box']['y'],
                'x2': face['box']['x'] + face['box']['width'],
                'y2': face['box']['y'] + face['box']['height']
            }
            try:
                res = vlm.verify_is_face(file_path, box_dict)
                log(f"  Result: {res}")
            except Exception as e:
                log(f"  VLM Error: {e}")


if __name__ == "__main__":
    debug()
