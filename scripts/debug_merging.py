
# Debug Merging Issue
import os
import sys

# Add src/python to path
sys.path.append(os.path.join(os.getcwd(), 'src', 'python'))

import cv2
import config
from facelib import detector, faces

# Force load AI_CONFIG to ensure we are testing real settings
from config import AI_CONFIG

IMG_PATH = r"M:\SampleMediumSetPics\pexels-filiamariss-14994487.jpg"

def debug_detection():
    print(f"Loading Image: {IMG_PATH}")
    img = cv2.imread(IMG_PATH)
    if img is None:
        print("Error: Could not read image.")
        return

    print(f"Initializing Detector with Config:")
    print(f"  NMS Threshold: {AI_CONFIG['face_detection']['nms_iou_threshold']}")
    
    det = detector.FaceDetector(config={
        'detThreshStandard': 0.60,
        'nmsIouThresh': AI_CONFIG['face_detection']['nms_iou_threshold'], # 0.5
        'enableTTA': False
    })
    
    print("\nRunning Detection...")
    results = det.detect(img, scan_mode='Isolate') # Should use standard scan
    
    print(f"\nFinal Results: {len(results)} faces found.")
    for i, res in enumerate(results):
        box = res['box']
        print(f"  Face {i+1}: Score={res['score']:.4f}, Box={box}")

if __name__ == "__main__":
    debug_detection()
