
import sqlite3
import cv2
import json
import os
import sys

# Setup paths
sys.path.append(os.path.join(os.getcwd(), 'src', 'python'))
from facelib import faces

DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"
FACE_ID = 232

def force_split():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Get Face
    face = cursor.execute("SELECT * FROM faces WHERE id = ?", (FACE_ID,)).fetchone()
    if not face:
        print(f"Face {FACE_ID} not found.")
        return

    # 2. Get Photo
    photo = cursor.execute("SELECT * FROM photos WHERE id = ?", (face['photo_id'],)).fetchone()
    if not photo:
        print(f"Photo for face {FACE_ID} not found.")
        return

    print(f"Processing Face {FACE_ID} in {photo['file_path']}")
    
    # 3. Load Image & Crop
    img_path = photo['file_path']
    if not os.path.exists(img_path):
        print("Image file not found.")
        return

    img = cv2.imread(img_path)
    if img is None:
        print("Failed to load image.")
        return

    box = json.loads(face['box_json'])
    x, y, w, h = box['x'], box['y'], box['width'], box['height']
    
    # Crop (with small margin for detector)
    h_img, w_img = img.shape[:2]
    m = 0.1 # 10% margin
    x1 = max(0, int(x - w*m))
    y1 = max(0, int(y - h*m))
    x2 = min(w_img, int(x + w + w*m))
    y2 = min(h_img, int(y + h + h*m))
    
    crop = img[y1:y2, x1:x2]
    
    # 4. Run Detection (640x640)
    print("Running detection on crop (640x640)...")
    faces.init_insightface(det_size=(640, 640), det_thresh=0.5)
    detected = faces.app.get(crop)
    
    print(f"Found {len(detected)} faces in crop.")
    
    if len(detected) > 1:
        print("SPLITTING! Updating DB...")
        
        # 5. Delete Original
        cursor.execute("DELETE FROM faces WHERE id = ?", (FACE_ID,))
        
        # 6. Insert New Faces
        for i, d in enumerate(detected):
            # Map back to original image coordinates
            # d.bbox is [x1, y1, x2, y2] relative to crop
            bx1, by1, bx2, by2 = d.bbox
            
            orig_x = int(x1 + bx1)
            orig_y = int(y1 + by1)
            orig_w = int(bx2 - bx1)
            orig_h = int(by2 - by1)
            
            new_box = json.dumps({"x": orig_x, "y": orig_y, "width": orig_w, "height": orig_h})
            descriptor = d.embedding.tobytes()
            
            cursor.execute("""
                INSERT INTO faces (photo_id, box_json, descriptor, score, entity_type, needs_bucketing, is_ignored)
                VALUES (?, ?, ?, ?, 'human', 1, 0)
            """, (face['photo_id'], new_box, descriptor, float(d.det_score)))
            print(f"  -> Inserted new face {i+1} (Score: {d.det_score:.2f})")
            
        conn.commit()
        print("Done. Please restart app/refresh UI.")
    else:
        print("Detection failed to find > 1 face. Cannot split.")

    conn.close()

if __name__ == "__main__":
    force_split()
