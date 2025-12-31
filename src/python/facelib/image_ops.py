import cv2
import numpy as np

def expand_box(bbox, img_width, img_height, expansion_factor=0.4):
    """
    Expands the bounding box by a factor to include more context (hair, ears, chin).
    bbox: [x1, y1, x2, y2]
    """
    x1, y1, x2, y2 = bbox
    w = x2 - x1
    h = y2 - y1
    
    # Calculate padding
    pad_w = w * expansion_factor * 0.5
    pad_h = h * expansion_factor * 0.5
    
    # Apply padding and clamp to image boundaries
    new_x1 = max(0, x1 - pad_w)
    new_y1 = max(0, y1 - pad_h)
    new_x2 = min(img_width, x2 + pad_w)
    new_y2 = min(img_height, y2 + pad_h)
    
    return [int(new_x1), int(new_y1), int(new_x2), int(new_y2)]

def smart_crop_landmarks(bbox, kps, img_width, img_height):
    """
    Uses 5 facial landmarks to center the crop and ensure adequate context.
    kps: 5x2 array [RightEye, LeftEye, Nose, RightMouth, LeftMouth]
    bbox: [x1, y1, x2, y2]
    """
    if kps is None or len(kps) == 0:
         return expand_box(bbox, img_width, img_height, 0.4)
    
    # Calculate crop center and size
    eye_center = np.mean(kps[:2], axis=0)
    mouth_center = np.mean(kps[3:], axis=0)
    face_center = (eye_center + mouth_center) / 2
    
    # Heuristic for face size based on landmarks
    face_size = np.linalg.norm(eye_center - mouth_center) * 2.5
    final_size = face_size * 1.5
    
    half_size = final_size / 2
    center_x, center_y = face_center
    
    # Shift center_y up slightly
    center_y_shifted = center_y - (final_size * 0.08)
    
    new_x1 = max(0, center_x - half_size)
    new_y1 = max(0, center_y_shifted - half_size)
    new_x2 = min(img_width, center_x + half_size)
    new_y2 = min(img_height, center_y_shifted + half_size)
    
    return [int(new_x1), int(new_y1), int(new_x2), int(new_y2)]

def estimate_blur(image, target_size=None):
    """
    Estimates the blurriness of an image using the Variance of Laplacian method.
    Higher values = Sharper. Lower values = Blurry.
    """
    if image is None or image.size == 0: return 0.0
    
    if target_size:
        h, w = image.shape[:2]
        if h > target_size or w > target_size:
             scale = target_size / max(h, w)
             new_w, new_h = int(w * scale), int(h * scale)
             image = cv2.resize(image, (new_w, new_h))
        
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()

def estimate_sharpness_tenengrad(image, target_size=None):
    """
    Estimates sharpness using the Tenengrad (Sobel gradient magnitude) method.
    Robust to noise and background blur. Returns mean squared magnitude.
    """
    if image is None or image.size == 0: return 0.0

    if target_size:
        h, w = image.shape[:2]
        if h > target_size or w > target_size:
            scale = target_size / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            image = cv2.resize(image, (new_w, new_h))

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Sobel Gradients
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    
    # Gradient Magnitude
    mag = cv2.magnitude(gx, gy)
    
    # Mean of squares (energy)
    return np.mean(mag * mag)
