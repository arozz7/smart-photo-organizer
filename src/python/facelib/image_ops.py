import cv2
import numpy as np

def expand_box(bbox, img_width, img_height, expansion_factor=0.25):
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
         return expand_box(bbox, img_width, img_height, 0.25)
    
    # Calculate crop center and size
    eye_center = np.mean(kps[:2], axis=0)
    mouth_center = np.mean(kps[3:], axis=0)
    face_center = (eye_center + mouth_center) / 2
    
    # Heuristic for face size based on landmarks
    face_size = np.linalg.norm(eye_center - mouth_center) * 2.5
    final_size = face_size * 1.3 # Reduced from 1.5 for tighter crop
    
    # [Safety Clamp] Prevent runaway expansion based on landmarks
    # Some landmarks (e.g. open mouth, extreme angle) can cause HUGE heuristic size.
    # We restrict the max crop to be at most 1.5x the ORIGINAL detection box max dim.
    input_w = bbox[2] - bbox[0]
    input_h = bbox[3] - bbox[1]
    max_input_dim = max(input_w, input_h)
    
    if final_size > (max_input_dim * 1.5):
         final_size = max_input_dim * 1.5
    
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

def get_aligned_bbox(bbox, kps, img_width, img_height):
    """
    Calculates the bounding box of the face as seen by the recognition model.
    Instead of heuristics, this uses the INVERSE of the alignment matrix.
    
    1. Calculate Transform M that aligns face to 112x112 standard.
    2. Invert M.
    3. Map the 4 corners of the 112x112 template back to original image.
    4. Return the bounding box of those projected corners.
    """
    if kps is None or len(kps) < 5:
        return expand_box(bbox, img_width, img_height, 0.25)

    # Standard InsightFace/ArcFace 112x112 Coordinates
    ref_pts = np.array([
        [38.2946, 51.6963], # Left Eye
        [73.5318, 51.5014], # Right Eye
        [56.0252, 71.7366], # Nose
        [41.5493, 92.3655], # Left Mouth
        [70.7299, 92.2041]  # Right Mouth
    ], dtype=np.float32)
    
    # Input landmarks
    src_pts = np.array(kps, dtype=np.float32)
    
    # Estimate Affine Transform: src_pts -> ref_pts
    # We use estimateAffinePartial2D for rigid/similarity transform (scale, rotation, translation)
    # RANSAC is robust to outliers, though landmarks are usually decent.
    try:
        M, _ = cv2.estimateAffinePartial2D(src_pts, ref_pts, method=cv2.LMEDS)
        
        if M is None:
             return expand_box(bbox, img_width, img_height, 0.25)
             
        # We want the INVERSE: ref_pts (112 box) -> src_pts (original img)
        # Invert the 2x3 matrix
        M_inv = cv2.invertAffineTransform(M)
        
        # Define the standard box corners (0,0) to (112,112)
        # We can add padding here if we want the "UI Box" to be slightly larger than the "AI Box"
        # The user requested tight but some padding is okay. 
        # But for "Pure" alignment, we use exactly 0-112.
        # Let's add slight padding (e.g. -10 to 122) to ensure chin/top-head isn't cut visually.
        pad = 0 # Start with 0 for pure test
        template_corners = np.array([
            [0-pad, 0-pad],
            [112+pad, 0-pad],
            [112+pad, 112+pad],
            [0-pad, 112+pad]
        ], dtype=np.float32)
        
        # Transform corners back
        # transform expects (N, 1, 2) shaped input or we can do manual matmul
        # Manual: [x, y, 1] . M_inv.T
        ones = np.ones((4, 1))
        corners_homo = np.hstack([template_corners, ones]) # 4x3
        
        # M_inv is 2x3. 
        # Result = corners_homo @ M_inv.T (which provides 4x2)
        projected_corners = corners_homo @ M_inv.T
        
        # Get bounding box of projected corners
        x_coords = projected_corners[:, 0]
        y_coords = projected_corners[:, 1]
        
        x1 = np.min(x_coords)
        y1 = np.min(y_coords)
        x2 = np.max(x_coords)
        y2 = np.max(y_coords)
        
        # Clamp to image
        x1 = max(0, int(x1))
        y1 = max(0, int(y1))
        x2 = min(img_width, int(x2))
        y2 = min(img_height, int(y2))
        
        # Safety Check: If inverted box is absurdly large (e.g. Singular Matrix issues), fallback
        w = x2 - x1
        h = y2 - y1
        raw_w = bbox[2] - bbox[0]
        if w > raw_w * 4: # Sanity check
             return expand_box(bbox, img_width, img_height, 0.25)
             
        return [x1, y1, x2, y2]
        
    except Exception as e:
        print(f"Alignment Error: {e}")
        return expand_box(bbox, img_width, img_height, 0.25)
