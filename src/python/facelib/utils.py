import sys
import os
import logging

# --- RUNTIME LOADING ---
# If an external AI runtime (torch, cuda, etc) is downloaded, we inject it into the path
LIBRARY_PATH = os.environ.get('LIBRARY_PATH', os.path.expanduser('~/.smart-photo-organizer'))
AI_RUNTIME_PATH = os.path.join(LIBRARY_PATH, 'ai-runtime')

def inject_runtime():
    """
    Scans for the AI Runtime and injects it into sys.path.
    Returns True if injected, False otherwise.
    """
    if os.environ.get('IS_DEV') == 'true':
        print("[AI_INIT] Dev Mode detected. Skipping AI Runtime injection.", file=sys.stderr)
        return False

    print(f"[AI_INIT] Checking for AI Runtime at: {AI_RUNTIME_PATH}", file=sys.stderr)
    
    if os.path.exists(AI_RUNTIME_PATH):
        # Search for site-packages (handle potential nesting from zip extraction)
        found_site_packages = None
        found_bin = None
        
        # Strat 1: Check standard location
        possible_site = os.path.join(AI_RUNTIME_PATH, 'lib', 'site-packages')
        if os.path.exists(possible_site):
            found_site_packages = possible_site
            found_bin = os.path.join(AI_RUNTIME_PATH, 'bin')
        else:
            # Strat 2: Search subdirectories (max depth 2)
            print("[AI_INIT] Runtime not found in root, searching subdirectories...", file=sys.stderr)
            for root, dirs, files in os.walk(AI_RUNTIME_PATH):
                 if 'site-packages' in dirs:
                     found_site_packages = os.path.join(root, 'site-packages')
                     parent = os.path.dirname(root) 
                     found_bin = os.path.join(parent, 'bin')
                     break
                 
                 # Limit depth
                 current_depth = root[len(AI_RUNTIME_PATH):].count(os.sep)
                 if current_depth > 2:
                     del dirs[:]

        if found_site_packages:
            if found_site_packages not in sys.path:
                print(f"[AI_INIT] Injecting runtime libraries from: {found_site_packages}", file=sys.stderr)
                sys.path.insert(0, found_site_packages)
            else:
                print(f"[AI_INIT] Runtime already in path: {found_site_packages}", file=sys.stderr)
            
            # --- DEBUG: CHECK MODULES ---
            try:
                # CHECK TORCHGEN
                tgen_path = os.path.join(found_site_packages, 'torchgen')
                if os.path.exists(tgen_path):
                     print(f"[AI_INIT] torchgen folder found at {tgen_path}", file=sys.stderr)
                     if os.path.exists(os.path.join(tgen_path, '__init__.py')):
                         print("[AI_INIT] torchgen/__init__.py exists", file=sys.stderr)
                     else:
                         print("[AI_INIT] ERROR: torchgen/__init__.py MISSING!", file=sys.stderr)
                else:
                     print("[AI_INIT] ERROR: torchgen folder NOT found!", file=sys.stderr)

                # ATTEMPT EXPLICIT IMPORT
                print("[AI_INIT] Attempting explicit 'import torchgen'...", file=sys.stderr)
                import torchgen
                print(f"[AI_INIT] 'import torchgen' SUCCESS. Path: {torchgen.__file__}", file=sys.stderr)
                
                print("[AI_INIT] Attempting explicit 'import yaml'...", file=sys.stderr)
                import yaml
                print(f"[AI_INIT] 'import yaml' SUCCESS. Path: {yaml.__file__}", file=sys.stderr)
                
            except ImportError as ie:
                print(f"[AI_INIT] Explicit import failed: {ie}", file=sys.stderr)
            except Exception as e:
                print(f"[AI_INIT] Debug check failed: {e}", file=sys.stderr)
            # ----------------------------

            # INSPECT TORCH VERSION
            try:
                torch_dir = os.path.join(found_site_packages, 'torch')
                if os.path.exists(torch_dir):
                    pyd_files = [f for f in os.listdir(torch_dir) if f.endswith('.pyd')]
                    print(f"[AI_INIT] Found torch .pyd files: {pyd_files}", file=sys.stderr)
                    
                    # Check for torch/lib
                    torch_lib_dir = os.path.join(torch_dir, 'lib')
                    if os.path.exists(torch_lib_dir):
                         dlls = [f for f in os.listdir(torch_lib_dir) if f.endswith('.dll')]
                         print(f"[AI_INIT] Found torch/lib DLLs: {len(dlls)} files", file=sys.stderr)
                         # Add torch/lib to DLL search path explicitly (just in case)
                         if os.name == 'nt':
                             try:
                                 os.add_dll_directory(torch_lib_dir)
                                 print(f"[AI_INIT] Added torch/lib to DLL directory", file=sys.stderr)
                             except: pass
                else:
                    print(f"[AI_INIT] Warning: 'torch' directory not found in {found_site_packages}", file=sys.stderr)
            except Exception as e:
                 print(f"[AI_INIT] Error inspecting torch: {e}", file=sys.stderr)

            # Also add DLL directory for CUDA
            if os.name == 'nt' and found_bin and os.path.exists(found_bin):
                try:
                    os.add_dll_directory(found_bin)
                    print(f"[AI_INIT] Added DLL directory: {found_bin}", file=sys.stderr)
                except Exception as e:
                    print(f"[AI_INIT] Failed to add DLL directory: {e}", file=sys.stderr)
                    
            return True
        else:
            print(f"[AI_INIT] AI Runtime folder exists at {AI_RUNTIME_PATH} but 'site-packages' could not be found.", file=sys.stderr)
            try:
                 print(f"[AI_INIT] Directory listing: {os.listdir(AI_RUNTIME_PATH)}", file=sys.stderr)
            except: pass
    else:
        print("[AI_INIT] AI Runtime folder not found. Using system environment or fallback.", file=sys.stderr)
    
    return False

def configure_logging(log_path=None):
    handlers = [logging.StreamHandler(sys.stderr)]
    if not log_path:
        log_path = os.environ.get('LOG_PATH')

    if log_path:
        if not os.path.exists(log_path):
            os.makedirs(log_path, exist_ok=True)
        from logging.handlers import RotatingFileHandler
        handlers.append(RotatingFileHandler(
            os.path.join(log_path, 'python.log'),
            maxBytes=5*1024*1024, # 5MB
            backupCount=1
        ))

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=handlers
    )
    return logging.getLogger('ai_engine')

# --- LAZY IMPORTS ---
def get_torch():
    try:
        import torch
        return torch
    except ImportError as e:
        print(f"[AI_INIT] Failed to import torch: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[AI_INIT] Unexpected error importing torch: {e}", file=sys.stderr)
        return None

def get_transformers():
    try:
        from transformers import AutoProcessor, AutoModelForVision2Seq
        return AutoProcessor, AutoModelForVision2Seq
    except ImportError:
        return None, None

def get_faiss():
    try:
        import faiss
        return faiss
    except ImportError:
        return None
