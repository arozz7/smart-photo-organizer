"""
Debug script to analyze face detections for the yoga photo.
Uses the correct dev database location and schema.
"""
import sqlite3
import json
from pathlib import Path

# Dev database path
DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"

# Photo identifier (partial filename match)
PHOTO_SEARCH = "vic_krop"

def analyze_photo_faces():
    if not Path(DB_PATH).exists():
        print(f"❌ Database not found at: {DB_PATH}")
        return
    
    print(f"✅ Connected to: {DB_PATH}\n")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Find the photo
    cursor.execute("""
        SELECT id, file_path
        FROM photos 
        WHERE file_path LIKE ?
    """, (f'%{PHOTO_SEARCH}%',))
    
    photo = cursor.fetchone()
    if not photo:
        print(f"❌ Photo not found matching: {PHOTO_SEARCH}")
        # Show some sample photos
        cursor.execute("SELECT id, file_path FROM photos LIMIT 5")
        samples = cursor.fetchall()
        print(f"\nSample photos in database:")
        for sample in samples:
            print(f"   - {sample['file_path']}")
        conn.close()
        return
    
    photo_id = photo['id']
    print(f"📸 Photo: {photo['file_path']}")
    print(f"   ID: {photo_id}")
    print("\n" + "="*80 + "\n")
    
    # Get all face detections
    cursor.execute("""
        SELECT 
            id,
            box_json,
            score,
            face_quality,
            is_ignored,
            entity_type,
            confidence_tier,
            verification_attempts,
            pose_yaw,
            pose_pitch,
            estimated_age,
            gender
        FROM faces
        WHERE photo_id = ?
        ORDER BY id DESC
    """, (photo_id,))
    
    faces = cursor.fetchall()
    
    if not faces:
        print("❌ No face detections found for this photo")
        conn.close()
        return
    
    # Valid/Invalid Lists
    results = []
    
    for face in faces:
        box = json.loads(face['box_json']) if face['box_json'] else {}
        width = box.get('width', 0)
        height = box.get('height', 0)
        
        results.append({
            'id': face['id'],
            'score': face['score'],
            'quality': face['face_quality'],
            'width': width,
            'height': height,
            'is_ignored': face['is_ignored']
        })

    with open('debug_faces.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2)

    print(f"Dumped {len(faces)} faces to debug_faces.json")
    conn.close()

if __name__ == "__main__":
    analyze_photo_faces()


