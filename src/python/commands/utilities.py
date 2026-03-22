"""
System utility commands for model downloads and status checks.

This module contains commands for downloading models, checking system status,
and other administrative operations. Extracted from main.py for file size compliance.
"""

import logging
import json
import os
import sys
import tempfile

# Import shared modules
import facelib.utils as utils
import facelib.faces as faces
import facelib.vlm as vlm
import facelib.vector_store as vector_store
import enhance
import cv2

logger = logging.getLogger('ai_engine.utilities')


def download_model(payload, req_id=None):
    """
    Download AI models (enhancement models or AI runtime).
    
    Args:
        payload: Command payload with modelName and optional url
        req_id: Request ID for response tracking
    
    Returns:
        dict: Download result with success status and save path
    """
    model_name = payload.get('modelName')
    logger.info(f"Downloading model: {model_name}")
    try:
        def progress_callback(current, total):
            if total > 0:
                pct = (current / total) * 100
                print(json.dumps({
                    "type": "download_progress",
                    "modelName": model_name,
                    "current": current,
                    "total": total,
                    "percent": pct,
                    "reqId": req_id
                }))
                sys.stdout.flush()

        url = payload.get('url', '')

        if 'AdaFace' in model_name:
            # AdaFace ONNX model — direct file download to models/ directory.
            # The large-model format uses a companion .onnx.data file; download both.
            import urllib.request
            models_dir = os.path.normpath(
                os.path.join(os.path.dirname(__file__), '..', 'models')
            )
            os.makedirs(models_dir, exist_ok=True)
            onnx_url = url or 'https://huggingface.co/mk-minchul/adaface/resolve/main/adaface_ir50_webface4m.onnx'
            data_url = onnx_url + '.data'
            for dl_url in [onnx_url, data_url]:
                filename = os.path.basename(dl_url)
                dest = os.path.join(models_dir, filename)
                logger.info(f"Downloading AdaFace file: {dl_url} → {dest}")
                enhance.enhancer.download_model_at_url(dl_url, dest, progress_callback)
            return {
                "type": "download_result",
                "success": True,
                "modelName": model_name,
                "savePath": models_dir,
                "reqId": req_id,
            }

        elif url and url.startswith('hf://'):
            # HuggingFace model download via huggingface_hub.
            # Requires prior authentication: huggingface-cli login
            repo_id = url[len('hf://'):]  # e.g. "facebook/sam3"
            from config import AI_CONFIG
            checkpoint_dir = AI_CONFIG.get('segmentation', {}).get(
                'model_checkpoint', 'models/sam3'
            )
            import huggingface_hub
            logger.info(f"Downloading HuggingFace model '{repo_id}' → '{checkpoint_dir}'")
            print(json.dumps({
                "type": "download_progress",
                "modelName": model_name,
                "status": "downloading",
                "message": f"Fetching {repo_id} from HuggingFace...",
                "reqId": req_id
            }))
            sys.stdout.flush()
            huggingface_hub.snapshot_download(
                repo_id=repo_id,
                local_dir=checkpoint_dir,
            )
            # Return early — the unconditional response assignment below
            # is for the AI-Runtime / enhance-model paths only.
            return {
                "type": "download_result",
                "success": True,
                "modelName": model_name,
                "savePath": checkpoint_dir,
                "reqId": req_id,
            }

        elif "AI GPU Runtime" in model_name:
            import zipfile
            temp_zip = os.path.join(tempfile.gettempdir(), "ai-runtime.zip")
            if os.path.exists(temp_zip):
                try: os.remove(temp_zip)
                except: pass

            # Dynamic URL support
            base_url = payload.get('url')
            if not base_url:
                # Fallback default if not provided (should accept version from IPC though)
                # Note: We expect IPC to provide versioned URL now.
                base_url = "https://github.com/arozz7/smart-photo-organizer/releases/download/v0.8.0/ai-runtime-win-x64.zip"

            # Check if this is a custom override (likely single file) or standard release (multi-part)
            # Heuristic: Try .001 first. If 404, fallback to single file.
            
            parts_downloaded = []
            part_num = 1
            multi_part_mode = False
            
            # Try .001 first
            first_part_url = f"{base_url}.001"
            logger.info(f"Checking for multi-part existence: {first_part_url}")
            
            try:
                # quick head/get check or just try download
                # Since we don't have a dedicated HEAD method in 'enhance' easily exposed, 
                # let's try to download part 1.
                part_1_path = f"{temp_zip}.001"
                if os.path.exists(part_1_path): os.remove(part_1_path)
                
                try:
                    # Attempt download part 1
                    logger.info(f"Attempting download of Part 1: {first_part_url}")
                    saved_p1 = enhance.enhancer.download_model_at_url(first_part_url, part_1_path, progress_callback)
                    parts_downloaded.append(saved_p1)
                    multi_part_mode = True
                except Exception as e:
                    logger.info(f"Part 1 not found ({e}). Assuming single file.")
                    multi_part_mode = False
            
            except:
                multi_part_mode = False
            
            if multi_part_mode:
                # Continue downloading subsequent parts
                while True:
                    part_num += 1
                    next_url = f"{base_url}.{part_num:03d}"
                    next_part_path = f"{temp_zip}.{part_num:03d}"
                    if os.path.exists(next_part_path): os.remove(next_part_path)
                    
                    logger.info(f"Downloading Part {part_num}: {next_url}")
                    try:
                        saved_pn = enhance.enhancer.download_model_at_url(next_url, next_part_path, progress_callback)
                        parts_downloaded.append(saved_pn)
                    except Exception:
                        logger.info(f"Part {part_num} not found. Finished downloading parts.")
                        break
                
                # Concatenate
                logger.info(f"Concatenating {len(parts_downloaded)} parts...")
                with open(temp_zip, 'wb') as outfile:
                    for p_path in parts_downloaded:
                        with open(p_path, 'rb') as infile:
                            import shutil
                            shutil.copyfileobj(infile, outfile)
                        try: os.remove(p_path) # Cleanup part
                        except: pass
                        
            else:
                # Single file mode (Override or legacy)
                logger.info(f"Downloading single file: {base_url}")
                enhance.enhancer.download_model_at_url(base_url, temp_zip, progress_callback)

            
            logger.info("Extracting AI Runtime...")
            # Signal extraction start to UI
            print(json.dumps({
                "type": "download_progress",
                "modelName": model_name,
                "status": "extracting",
                "reqId": req_id
            }))
            sys.stdout.flush()
            
            with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                zip_ref.extractall(utils.AI_RUNTIME_PATH)
            
            if os.path.exists(temp_zip): os.remove(temp_zip)
            
            # RE-INJECT
            logger.info("Attempting to inject new runtime...")
            if utils.inject_runtime():
                logger.info("Runtime injected. Re-initializing...")
                # 1. Reload Torch (not easy in python without reload, but utils.get_torch might pick it up if sys.path changed)
                # 2. Reset faces app
                faces.app = None
                faces.AI_MODE = "GPU" # Optimistic
            else:
                logger.warning("Runtime injection failed after download.")
        else:
            save_path = enhance.enhancer.download_model_with_progress(model_name, progress_callback)
        
        response = {"type": "download_result", "success": True, "modelName": model_name, "savePath": str(utils.AI_RUNTIME_PATH), "reqId": req_id}
    except Exception as e:
        logger.exception("Download Error")
        response = {"type": "download_result", "success": False, "error": str(e), "reqId": req_id}
    
    return response


def get_system_status(req_id=None, runtime_url: str | None = None):
    """
    Get comprehensive system status including models, InsightFace, FAISS, VLM, and system info.

    Args:
        req_id:      Request ID for response tracking.
        runtime_url: Version-correct AI Runtime download URL forwarded from Electron so that
                     the displayed URL in ModelDownloader always matches the running app version.

    Returns:
        dict: System status with all component information
    """
    status = {}
    try:
        # Check Models (Robustly)
        try:
            status['models'] = utils.get_model_status(
                enhance.MODEL_URLS, enhance.WEIGHTS_DIR, runtime_url=runtime_url
            )
        except Exception as e:
            logger.error(f"Status Check (Models) failed: {e}")
            status['models'] = {"error": str(e)}

        # InsightFace
        status['insightface'] = {
            'loaded': (faces.app is not None),
            'providers': faces.CURRENT_PROVIDERS if faces.CURRENT_PROVIDERS else [],
            'det_thresh': faces.DET_THRESH
        }

        # FAISS
        try:
            status['faiss'] = {
                'loaded': (vector_store.index is not None), 
                'count': vector_store.index.ntotal if vector_store.index else 0,
                'dim': (vector_store.index.d if (vector_store.index and hasattr(vector_store.index, 'd') and vector_store.index.d > 0) else 512) if vector_store.index else 0
            }
        except Exception as e:
            logger.error(f"Status Check (FAISS) failed: {e}")
            status['faiss'] = {'loaded': False, 'error': str(e)}

        # VLM
        torch_lib = utils.get_torch()
        status['vlm'] = {
            'loaded': (vlm.vlm_model is not None),
            'device': "cuda" if torch_lib and torch_lib.cuda.is_available() else "cpu",
            'model': 'SmolVLM-Instruct'
        }
        
        # System
        status['system'] = {
            'python': sys.version.split()[0],
            'torch': "Unknown",
            'cuda_available': False,
            'cuda_device': "N/A",
            'onnxruntime': "Unknown",
            'opencv': cv2.__version__ if hasattr(cv2, '__version__') else "Unknown",
            'ai_runtime_path': utils.AI_RUNTIME_PATH
        }
        try:
            import onnxruntime
            status['system']['onnxruntime'] = onnxruntime.__version__
        except: pass

        try:
            if torch_lib:
                status['system']['torch'] = torch_lib.__version__
                if torch_lib.cuda.is_available():
                    status['system']['cuda_available'] = True
                    status['system']['cuda_device'] = torch_lib.cuda.get_device_name(0)
        except: pass

        response = {"type": "system_status_result", "status": status, "reqId": req_id}
        
    except Exception as e:
         logger.exception("FATAL in get_system_status")
         response = {"type": "system_status_result", "error": str(e), "reqId": req_id}
    
    return response


def get_index_status(req_id=None):
    """
    Get detailed FAISS index status for diagnostics.
    
    Args:
        req_id: Request ID for response tracking
    
    Returns:
        dict: Index status with vector count, dimension, and ID mapping info
    """
    try:
        index_status = {
            'loaded': (vector_store.index is not None),
            'total_vectors': vector_store.index.ntotal if vector_store.index else 0,
            'dimension': vector_store.index.d if vector_store.index else 0,
        }
        
        # Get ID mapping breakdown
        if hasattr(vector_store, 'id_map') and vector_store.id_map:
            index_status['id_map_size'] = len(vector_store.id_map)
            # Sample of IDs in index
            sample_ids = list(vector_store.id_map.values())[:20]
            index_status['sample_face_ids'] = sample_ids
        else:
            index_status['id_map_size'] = 0
            index_status['sample_face_ids'] = []
        
        response = {"type": "index_status_result", "status": index_status, "reqId": req_id}
    except Exception as e:
        logger.error(f"Get index status error: {e}")
        response = {"type": "index_status_result", "error": str(e), "reqId": req_id}
    
    return response
