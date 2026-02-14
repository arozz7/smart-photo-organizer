import sys
import os
import cv2
import numpy as np

# Use current directory (src/python) to find facelib
current_dir = os.getcwd()
sys.path.append(current_dir)

try:
    import facelib.utils as utils
    import facelib.faces as faces
    import facelib.image_ops as image_ops
except ImportError as e:
    print(f"Import Error: {e}")
    sys.exit(1)

# Init Environment
utils.inject_runtime()
print("Initializing InsightFace...")
faces.init_insightface(det_size=(1280, 1280))

# User Screenshot Path
input_path = r"C:/Users/arozz/.gemini/antigravity/brain/7939234d-d36e-4db2-9ce9-2c406b8357a4/uploaded_media_1769798659789.png"
print(f"Loading {input_path}")
img = cv2.imread(input_path)

if img is None:
    print("Failed to load image")
    sys.exit(1)

print("Running Detection...")
results = faces.app.get(img)
print(f"Found {len(results)} faces")

debug_img = img.copy()

for i, face in enumerate(results):
    bbox = face.bbox.astype(int)
    kps = face.kps
    score = face.det_score
    
    # 1. Logic Verification (Using current image_ops logic)
    expanded = image_ops.smart_crop_landmarks(bbox, kps, img.shape[1], img.shape[0])
    sc_w = expanded[2] - expanded[0]
    sc_h = expanded[3] - expanded[1]
    
    # Calculate Clamping Stats
    raw_max_dim = max(bbox[2]-bbox[0], bbox[3]-bbox[1])
    clamp_limit = raw_max_dim * 1.5
    
    # Check Filter Logic
    accepted = True
    if sc_w < 60 and score < 0.75:
        accepted = False
    
    status = "OK" if accepted else "REJECTED"
    
    print(f"Face {i}: Score={score:.3f}")
    print(f"  Raw Box: {bbox} (MaxDim: {raw_max_dim})")
    print(f"  Smart Crop: {expanded} (Dim: {sc_w}x{sc_h})")
    print(f"  Clamp Limit (1.5x): {clamp_limit}")
    print(f"  Status: {status}")
    
    # Draw Results
    color = (0, 255, 0) if accepted else (0, 0, 255) # Green if accepted, Red if rejected
    
    # Draw Green Box (Smart Crop)
    cv2.rectangle(debug_img, (expanded[0], expanded[1]), (expanded[2], expanded[3]), color, 3)
    
    # Draw Yellow Box (Raw Detection)
    cv2.rectangle(debug_img, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 255, 255), 2)
    
    # Draw Landmarks (Blue)
    if kps is not None:
        for p in kps:
             cv2.circle(debug_img, (int(p[0]), int(p[1])), 3, (255, 0, 0), -1)

output_file = "debug_diagnosis.jpg"
cv2.imwrite(output_file, debug_img)
print(f"Saved visualization to {os.path.abspath(output_file)}")
