
import os
import sys

# Add src/python to path
sys.path.append(os.path.join(os.getcwd(), 'src', 'python'))

import cv2
from facelib import vlm
# Force load AI_CONFIG to ensure we are testing real settings
from config import AI_CONFIG

IMG_PATH = r"M:\SampleMediumSetPics\pexels-filiamariss-14994487.jpg"
# Fix: vlm.verify_is_face expects a dict with keys x1, y1, x2, y2
BOX = {
    'x1': 173, 
    'y1': 1050, 
    'x2': 173+3070, 
    'y2': 1050+3315
}

def debug_vlm():
    print(f"Loading Image: {IMG_PATH}")
    print(f"Testing Box: {BOX}")
    
    res = vlm.verify_is_face(IMG_PATH, BOX)
    
    print("\nVLM Result:")
    print(res)

if __name__ == "__main__":
    debug_vlm()
