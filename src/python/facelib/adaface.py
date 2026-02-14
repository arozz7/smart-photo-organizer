"""
AdaFace: Adaptive Face Recognition Model for Low-Quality Faces

This module provides AdaFace model integration for improved recognition
on blurry, profile, or distant faces. Uses ONNX Runtime for inference.

Phase 59: AdaFace Integration
"""

import os
import logging
import numpy as np
import cv2

logger = logging.getLogger('ai_engine.adaface')

# Global model instance
adaface_session = None
MODEL_LOADED = False
MODEL_PATH = None

def init_adaface(model_path=None):
    """
    Initialize AdaFace model for embedding extraction.
    
    Args:
        model_path: Path to ONNX model file. If None, uses default from config.
    
    Returns:
        bool: True if initialization successful, False otherwise
    """
    global adaface_session, MODEL_LOADED, MODEL_PATH
    
    if MODEL_LOADED and adaface_session is not None:
        logger.debug("[AdaFace] Model already loaded")
        return True
    
    try:
        import onnxruntime as ort
        
        # Use provided path or default
        if model_path is None:
            from config import ADAFACE_MODEL_PATH
            model_path = ADAFACE_MODEL_PATH
        
        MODEL_PATH = model_path
        
        # Check if model file exists (try CWD-relative first, then AI runtime directory)
        if not os.path.exists(model_path):
            from facelib.utils import AI_RUNTIME_PATH
            runtime_model_path = os.path.join(AI_RUNTIME_PATH, model_path)
            if os.path.exists(runtime_model_path):
                logger.info(f"[AdaFace] Model found in AI runtime: {runtime_model_path}")
                model_path = runtime_model_path
            else:
                logger.warning(f"[AdaFace] Model not found at {model_path} or {runtime_model_path}")
                logger.warning("[AdaFace] Please download or convert AdaFace model to ONNX format")
                logger.warning("[AdaFace] Falling back to ArcFace only")
                return False
        
        # Load ONNX model
        logger.info(f"[AdaFace] Loading model from {model_path}...")
        
        # Use CPU execution provider for compatibility
        # GPU providers can be added later if needed
        providers = ['CPUExecutionProvider']
        
        adaface_session = ort.InferenceSession(model_path, providers=providers)
        
        # Get model input/output info
        input_name = adaface_session.get_inputs()[0].name
        input_shape = adaface_session.get_inputs()[0].shape
        output_name = adaface_session.get_outputs()[0].name
        output_shape = adaface_session.get_outputs()[0].shape
        
        logger.info(f"[AdaFace] Model loaded successfully")
        logger.info(f"[AdaFace] Input: {input_name} {input_shape}")
        logger.info(f"[AdaFace] Output: {output_name} {output_shape}")
        
        # Verify output is 512-dim (compatible with ArcFace)
        if output_shape[-1] != 512:
            logger.error(f"[AdaFace] Invalid output dimension: {output_shape[-1]} (expected 512)")
            adaface_session = None
            return False
        
        MODEL_LOADED = True
        return True
        
    except ImportError:
        logger.error("[AdaFace] onnxruntime not installed. Install with: pip install onnxruntime")
        return False
    except Exception as e:
        logger.error(f"[AdaFace] Failed to load model: {e}")
        adaface_session = None
        return False


def preprocess_face(face_img):
    """
    Preprocess face image for AdaFace model input.
    
    Args:
        face_img: Face image (BGR, uint8)
    
    Returns:
        np.ndarray: Preprocessed image tensor (1, 3, 112, 112)
    """
    # Resize to 112x112 (AdaFace standard input size)
    face_resized = cv2.resize(face_img, (112, 112))
    
    # Convert BGR to RGB
    face_rgb = cv2.cvtColor(face_resized, cv2.COLOR_BGR2RGB)
    
    # Normalize to [-1, 1] (AdaFace preprocessing)
    face_normalized = (face_rgb.astype(np.float32) - 127.5) / 127.5
    
    # Transpose to (C, H, W) and add batch dimension
    face_tensor = np.transpose(face_normalized, (2, 0, 1))
    face_batch = np.expand_dims(face_tensor, axis=0)
    
    return face_batch.astype(np.float32)


def get_embedding(face_img):
    """
    Extract 512-dim embedding from face image using AdaFace.
    
    Args:
        face_img: Face image (BGR, uint8, any size)
    
    Returns:
        np.ndarray: 512-dim embedding vector, or None if extraction fails
    """
    global adaface_session, MODEL_LOADED
    
    if not MODEL_LOADED or adaface_session is None:
        logger.warning("[AdaFace] Model not loaded, cannot extract embedding")
        return None
    
    try:
        # Preprocess face image
        input_tensor = preprocess_face(face_img)
        
        # Get input name
        input_name = adaface_session.get_inputs()[0].name
        
        # Run inference
        outputs = adaface_session.run(None, {input_name: input_tensor})
        
        # Extract embedding (first output)
        embedding = outputs[0][0]  # Remove batch dimension
        
        # Normalize embedding (L2 normalization)
        embedding_norm = embedding / np.linalg.norm(embedding)
        
        return embedding_norm
        
    except Exception as e:
        logger.error(f"[AdaFace] Embedding extraction failed: {e}")
        return None


def is_available():
    """
    Check if AdaFace model is available and loaded.
    
    Returns:
        bool: True if model is ready for use
    """
    return MODEL_LOADED and adaface_session is not None


def get_model_info():
    """
    Get information about the loaded AdaFace model.
    
    Returns:
        dict: Model information (path, status, etc.)
    """
    return {
        'loaded': MODEL_LOADED,
        'model_path': MODEL_PATH,
        'available': is_available()
    }
