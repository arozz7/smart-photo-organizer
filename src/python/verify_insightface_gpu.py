import sys
import os
import onnxruntime

# --- DLL Patch Logic (From main.py) ---
if os.name == 'nt':
    try:
        import nvidia.cudnn
        import nvidia.cublas
        
        try:
            cudnn_dir = os.path.dirname(nvidia.cudnn.__file__)
        except:
             cudnn_dir = list(nvidia.cudnn.__path__)[0]
             
        try:
             cublas_dir = os.path.dirname(nvidia.cublas.__file__)
        except:
             cublas_dir = list(nvidia.cublas.__path__)[0]
        
        for p in [cudnn_dir, os.path.join(cudnn_dir, 'bin'), cublas_dir, os.path.join(cublas_dir, 'bin')]:
             if os.path.exists(p):
                 try:
                     os.add_dll_directory(p)
                 except Exception:
                     pass
        os.environ['PATH'] = os.path.pathsep.join([cudnn_dir, os.path.join(cudnn_dir, 'bin')] + os.environ['PATH'].split(os.path.pathsep))
                     
    except ImportError:
        pass

from insightface.app import FaceAnalysis

print("--- ONNX Runtime Check ---")
print(f"Device: {onnxruntime.get_device()}")
print(f"Available Providers: {onnxruntime.get_available_providers()}")

print("\n--- Initializing InsightFace ---")
# Force verbose logging from ONNX if possible, or just rely on providers check
app = FaceAnalysis(name='buffalo_l', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
try:
    app.prepare(ctx_id=0, det_size=(640, 640))
except Exception as e:
    print(f"Prepare failed: {e}")

print("\n--- Checking Active Providers ---")
for model_key in app.models:
    model = app.models[model_key]
    print(f"Model: {model_key}")
    
    # InsightFace models wrap the ONNX session in .session or .net.session depending on version
    session = None
    if hasattr(model, 'session'):
        session = model.session
    elif hasattr(model, 'net') and hasattr(model.net, 'session'):
         session = model.net.session
    elif hasattr(model, 'detector') and hasattr(model.detector, 'session'):
         session = model.detector.session
         
    if session:
        print(f"  Active Providers: {session.get_providers()}")
    else:
        print("  Could not access ONNX session.")
