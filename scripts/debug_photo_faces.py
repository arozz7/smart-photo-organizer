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
    
    print(f"Found {len(faces)} face detection(s):\n")
    
    for i, face in enumerate(faces, 1):
        status = "🚫 IGNORED" if face['is_ignored'] else "✅ ACTIVE"
        entity = face['entity_type'] or 'unknown'
        
        # Parse box_json
        box = json.loads(face['box_json']) if face['box_json'] else {}
        
        print(f"Face #{i} [{status}] (Entity: {entity})")
        print(f"  ID: {face['id']}")
        print(f"  BBox: {box}")
        print(f"  Detection Score: {face['score']:.3f}" if face['score'] else "  Detection Score: None")
        print(f"  Face Quality: {face['face_quality']:.3f}" if face['face_quality'] else "  Face Quality: None")
        print(f"  Confidence Tier: {face['confidence_tier']}")
        print(f"  Verification Attempts: {face['verification_attempts']}")
        
        if face['pose_yaw'] is not None:
            print(f"  Pose: yaw={face['pose_yaw']:.1f}°, pitch={face['pose_pitch']:.1f}°")
        
        if face['estimated_age']:
            print(f"  Age: {face['estimated_age']}, Gender: {face['gender']}")  # noqa - debug script, ML-estimated demographics not PII
        
        print("\n" + "-"*80 + "\n")
    
    # Summary
    active_faces = [f for f in faces if not f['is_ignored']]
    ignored_faces = [f for f in faces if f['is_ignored']]
    
    print("="*80)
    print(f"📊 SUMMARY:")
    print(f"   Total Detections: {len(faces)}")
    print(f"   Active Faces: {len(active_faces)}")
    print(f"   Ignored Faces: {len(ignored_faces)}")
    
    if ignored_faces:
        print(f"\n⚠️  IGNORED FACES (should not reappear on rescan):")
        for face in ignored_faces:
            entity = face['entity_type'] or 'unknown'
            print(f"   - Face {face['id']}: Entity={entity}, Tier={face['confidence_tier']}")
    
    if len(active_faces) > 2:
        print(f"\n🚨 PROBLEM DETECTED: {len(active_faces)} active faces (expected 2 valid faces)")
        print(f"   This suggests non-face boxes are still present!")
        print(f"\n   Active faces breakdown:")
        for face in active_faces:
            entity = face['entity_type'] or 'unknown'
            tier = face['confidence_tier'] or 'unknown'
            score = face['score'] if face['score'] else 0
            print(f"   - Face {face['id']}: Entity={entity}, Tier={tier}, Score={score:.3f}")
    
    conn.close()

if __name__ == "__main__":
    analyze_photo_faces()

