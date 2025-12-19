import os
import cv2
import requests
import warnings
import sys

# --- LAZY IMPORTS ---
def get_heavy_libs():
    try:
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
        from gfpgan import GFPGANer
        import torch
        return RRDBNet, RealESRGANer, GFPGANer, torch
    except ImportError:
        return None, None, None, None

import tqdm
import piexif

# Model Weights URLs
MODEL_URLS = {
    'RealESRGAN_x4plus': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
    'RealESRGAN_x4plus_anime_6B': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth',
    'GFPGANv1.4': 'https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth'
}

# Where to store weights
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), 'weights')
os.makedirs(WEIGHTS_DIR, exist_ok=True)

class Enhancer:
    def __init__(self):
        self.upsampler = None
        self.face_enhancer = None
        self.current_model_name = None

    def download_model_with_progress(self, model_name, progress_callback=None):
        url = MODEL_URLS.get(model_name)
        if not url:
            raise ValueError(f"Unknown model: {model_name}")
        
        save_path = os.path.join(WEIGHTS_DIR, f"{model_name}.pth")
        if os.path.exists(save_path):
            return save_path
            
        print(f"Downloading {model_name} from {url}...")
        response = requests.get(url, stream=True)
        response.raise_for_status()
        total_size = int(response.headers.get('content-length', 0))
        
        current_size = 0
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=16384): # Larger chunk for speed
                if chunk:
                    f.write(chunk)
                    current_size += len(chunk)
                    if progress_callback:
                        progress_callback(current_size, total_size)
        return save_path

    def _download_model(self, model_name):
        # Legacy/Internal use
        return self.download_model_with_progress(model_name)

    def download_model_at_url(self, url, save_path, progress_callback=None):
        if os.path.exists(save_path):
             return save_path
            
        print(f"Downloading from {url}...")
        response = requests.get(url, stream=True)
        response.raise_for_status()
        total_size = int(response.headers.get('content-length', 0))
        
        current_size = 0
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=16384):
                if chunk:
                    f.write(chunk)
                    current_size += len(chunk)
                    if progress_callback:
                        progress_callback(current_size, total_size)
        return save_path

    def load_upsampler(self, model_name='RealESRGAN_x4plus'):
        if self.current_model_name == model_name and self.upsampler:
            return

        model_path = os.path.join(WEIGHTS_DIR, f"{model_name}.pth")
        if not os.path.exists(model_path):
             # Auto-download or raise error? Plan said "On-Demand Download" via UI.
             # But here we might want to fail if not found so UI knows to prompt download.
             # OR: self._download_model(model_name) if we want convenience. 
             # Let's check existence and raise specific error.
             raise FileNotFoundError(f"Model {model_name} not found. Please download it first.")
        RRDBNet, RealESRGANer, GFPGANer, torch = get_heavy_libs()
        if not torch:
            raise ImportError("AI GPU Runtime (Torch) not found. Please download it via Manage Models.")

        if model_name == 'RealESRGAN_x4plus':
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
            # Use tile=1024 to avoid OOM on large images (was 0/auto)
            self.upsampler = RealESRGANer(scale=4, model_path=model_path, model=model, tile=1024, tile_pad=10, pre_pad=0, half=torch.cuda.is_available())
        elif model_name == 'RealESRGAN_x4plus_anime_6B':
             model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4)
             self.upsampler = RealESRGANer(scale=4, model_path=model_path, model=model, tile=1024, tile_pad=10, pre_pad=0, half=torch.cuda.is_available())
        
        self.current_model_name = model_name

    def load_gfpgan(self):
        model_path = os.path.join(WEIGHTS_DIR, 'GFPGANv1.4.pth')
        if not os.path.exists(model_path):
             raise FileNotFoundError("GFPGANv1.4 model not found.")
        
        RRDBNet, RealESRGANer, GFPGANer, torch = get_heavy_libs()
        if not torch:
            raise ImportError("AI GPU Runtime (Torch) not found. Please download it via Manage Models.")
        
        # GFPGANer handles loading automatically if we pass model_path
        # But we want to control when it loads.
        self.face_enhancer = GFPGANer(model_path=model_path, upscale=2, arch='clean', channel_multiplier=2, bg_upsampler=self.upsampler, device=torch.device('cuda' if torch.cuda.is_available() else 'cpu'))

    def enhance(self, img_path, out_path, task='upscale', model_name='RealESRGAN_x4plus', face_enhance=False):
        img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise FileNotFoundError(f"Image not found: {img_path}")

        if task == 'upscale':
            # Safeguard: Ensure model is valid for upscaling
            if 'RealESRGAN' not in model_name: 
                print(f"Warning: {model_name} is not an upsampler. Defaulting to RealESRGAN_x4plus.")
                model_name = 'RealESRGAN_x4plus'

            self.load_upsampler(model_name)
            output, _ = self.upsampler.enhance(img, outscale=4)
            
            if face_enhance:
                if not self.face_enhancer:
                     self.load_gfpgan() # This might fail if weights missing
                
                # GFPGAN inference
                _, _, output = self.face_enhancer.enhance(output, has_aligned=False, only_center_face=False, paste_back=True)

        elif task == 'restore_faces':
             if not self.face_enhancer:
                self.load_gfpgan()
             # For pure face restoration without big upscaling
             _, _, output = self.face_enhancer.enhance(img, has_aligned=False, only_center_face=False, paste_back=True)
        
        cv2.imwrite(out_path, output)
        
        # Transfer EXIF to preserve orientation
        try:
            exif_dict = piexif.load(img_path)
            exif_bytes = piexif.dump(exif_dict)
            piexif.insert(exif_bytes, out_path)
        except Exception as e:
            print(f"Failed to transfer EXIF: {e}")
            # Non-critical, continue
            
        return out_path

# Global instance
enhancer = Enhancer()
