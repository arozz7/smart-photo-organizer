import numpy as np
import pytest
from facelib import image_ops

def test_expand_box():
    # Original box [x1, y1, x2, y2]
    # Simple 20x20 box
    bbox = [20, 20, 40, 40]
    img_w, img_h = 100, 100
    
    # Expansion factor 0.4
    # pad_w = 20 * 0.4 * 0.5 = 4
    # new_x1 = 20 - 4 = 16
    # new_x2 = 40 + 4 = 44
    expanded = image_ops.expand_box(bbox, img_w, img_h, 0.4)
    expect = [16, 16, 44, 44]
    
    assert expanded == expect

def test_expand_box_clamping():
    bbox = [2, 2, 10, 10]
    img_w, img_h = 20, 20
    # pad = 8 * 0.4 * 0.5 = 1.6
    # x1 = 2 - 1.6 = 0.4 -> 0
    # x2 = 10 + 1.6 = 11.6 -> 11
    expanded = image_ops.expand_box(bbox, img_w, img_h, 0.4)
    assert expanded[0] == 0
    assert expanded[2] == 11

def test_estimate_blur():
    # Black image should have 0 variance
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    blur = image_ops.estimate_blur(img)
    assert blur == 0.0
    
    # Image with sharp edges
    img[20:80, 20:80] = 255
    blur_sharp = image_ops.estimate_blur(img)
    assert blur_sharp > 100 # Definitely more than 0

def test_estimate_sharpness_tenengrad():
    # Black image
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    sharp = image_ops.estimate_sharpness_tenengrad(img)
    assert sharp == 0.0
    
    # Sharp image
    img[20:80, 20:80] = 255
    sharp_high = image_ops.estimate_sharpness_tenengrad(img)
    assert sharp_high > 0

def test_smart_crop_landmarks():
    bbox = [20, 20, 40, 40]
    # 5 kps: [REye, LEye, Nose, RMouth, LMouth]
    kps = np.array([
        [25, 25], # RE
        [35, 25], # LE
        [30, 30], # Nose
        [25, 35], # RM
        [35, 35], # LM
    ])
    
    img_w, img_h = 100, 100
    cropped = image_ops.smart_crop_landmarks(bbox, kps, img_w, img_h)
    
    # Check that it returns a valid box
    assert len(cropped) == 4
    assert all(isinstance(x, int) for x in cropped)
    assert cropped[0] < cropped[2]
    assert cropped[1] < cropped[3]
    
def test_smart_crop_fallback_to_expand():
    bbox = [10, 10, 20, 20]
    # No landmarks
    cropped = image_ops.smart_crop_landmarks(bbox, None, 100, 100)
    expanded = image_ops.expand_box(bbox, 100, 100, 0.4)
    assert cropped == expanded
