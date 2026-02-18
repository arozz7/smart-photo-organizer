
import sys
import os
import cv2
import logging
from pathlib import Path

# Setup paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SRC_PYTHON = PROJECT_ROOT / "src" / "python"
sys.path.append(str(SRC_PYTHON))




# Configure logging
logging.basicConfig(level=logging.DEBUG) 
logger = logging.getLogger('ai_engine.detector')

# Make sure faces logger prints to file
faces_logger = logging.getLogger('ai_engine.faces')
faces_logger.setLevel(logging.DEBUG)
file_handler = logging.FileHandler('reproduction_output.txt', mode='w', encoding='utf-8')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
faces_logger.addHandler(file_handler)

# Also capture root logger to file
logging.getLogger().addHandler(file_handler)


try:
    from facelib import faces
    from facelib.detector import FaceDetector
    from config import AI_CONFIG
except ImportError as e:
    print(f"Error importing modules: {e}")
    sys.exit(1)

# Target Image
IMG_PATH = r"M:\SampleMediumSetPics\photographer vic_krop.jfif"

def run_debug_detection():
    print("DEBUG: Checking dependencies...")
    try:
        import onnxruntime
        print(f"DEBUG: onnxruntime version: {onnxruntime.__version__}")
        print(f"DEBUG: onnxruntime providers: {onnxruntime.get_available_providers()}")
    except ImportError:
        print("DEBUG: onnxruntime not found!")

    if not os.path.exists(IMG_PATH):
        print(f"❌ Image not found: {IMG_PATH}")
        return

    print(f"📸 Testing Image: {IMG_PATH}")
    img = cv2.imread(IMG_PATH)
    if img is None:
        print("❌ Failed to load image")
        return

    print(f"   Resolution: {img.shape[1]}x{img.shape[0]}")
    
    # Explicitly try to init faces to see error
    print("DEBUG: Attempting explicit faces.init_insightface...")
    try:
        faces.init_insightface(det_size=(640, 640))
        if faces.app is None:
             print("❌ faces.app is None after explicit init! Check logs above.")
        else:
             print("✅ faces.app initialized successfully.")
    except Exception as e:
        print(f"❌ faces.init_insightface threw exception: {e}")
        import traceback
        traceback.print_exc()

    # 1. Test with Current Config (TTA likely False)

    print("\n" + "="*50)
    print("🔹 Test 1: Standard Detection (Current Config)")
    print(f"   TTA Enabled in Config: {AI_CONFIG['face_detection'].get('enable_tta')}")
    
    detector = FaceDetector()
    results = detector.detect(img, scan_mode='MACRO') # Use MACRO to be most aggressive
    
    print(f"   Found {len(results)} faces:")
    for i, res in enumerate(results):
        print(f"   Face #{i+1}: Score={res['score']:.4f}, Quality={res['faceQuality']:.4f}, Rot={res.get('rotation_fix', 0)}")

    # 2. Test with TTA Forced ON
    print("\n" + "="*50)
    print("🔹 Test 2: Detection with TTA FORCED ON")
    
    # Init detector with TTA override
    detector_tta = FaceDetector(config={'enableTTA': True})
    # Force enable_tta property just in case init logic prioritizes global config
    detector_tta.enable_tta = True 
    
    results_tta = detector_tta.detect(img, scan_mode='MACRO')
    
    print(f"   Found {len(results_tta)} faces:")
    for i, res in enumerate(results_tta):
        print(f"   Face #{i+1}: Score={res['score']:.4f}, Quality={res['faceQuality']:.4f}, Rot={res.get('rotation_fix', 0)}")

    # 3. Test with Low Threshold (to see if it was rejected by score)
    print("\n" + "="*50)
    print("🔹 Test 3: Detection with Low Threshold (0.10)")
    
    # Patch config temporarily
    original_macro = detector.det_thresh_macro
    detector.det_thresh_macro = 0.10
    
    results_low = detector.detect(img, scan_mode='MACRO')
    detector.det_thresh_macro = original_macro # Restore
    
    print(f"   Found {len(results_low)} faces:")
    for i, res in enumerate(results_low):
        print(f"   Face #{i+1}: Score={res['score']:.4f}, Quality={res['faceQuality']:.4f}")

if __name__ == "__main__":
    run_debug_detection()
