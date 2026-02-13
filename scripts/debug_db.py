import sqlite3
import json
import os

# DB Path
DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"
TARGET_FILES = ["Wink Wink"]

def analyze_targets():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Check tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t['name'] for t in cursor.fetchall()]
        face_table = "Face" if "Face" in tables else "faces"
        photo_table = "Photo" if "Photo" in tables else "photos"
        
        # Get columns
        cursor.execute(f"PRAGMA table_info({face_table});")
        fcolumns = [c['name'] for c in cursor.fetchall()]
        
        cursor.execute(f"PRAGMA table_info({photo_table});")
        pcolumns = [c['name'] for c in cursor.fetchall()]
        path_col = "path"
        for c in pcolumns:
            if "path" in c.lower():
                path_col = c
                break

        print(f"DEBUGGING TARGETS IN: {DB_PATH}")
        
        for partial in TARGET_FILES:
            print(f"\n==========================================")
            print(f"SEARCHING FOR: {partial}")
            print(f"==========================================")
            
            cursor.execute(f"SELECT * FROM {photo_table} WHERE {path_col} LIKE ?", (f"%{partial}%",))
            photo = cursor.fetchone()
            
            if not photo:
                print("Photo not found.")
                continue
                
            print(f"Found Photo ID: {photo['id']}")
            print(f"Path: {photo[path_col]}")
            
            # Get all faces (ignored and active)
            fk_col = "photo_id" # Corrected column name
            cursor.execute(f"SELECT * FROM {face_table} WHERE {fk_col} = ?", (photo['id'],))
            faces = cursor.fetchall()
            
            print(f"Total Faces: {len(faces)}")
            
            for f in faces:
                f_dict = dict(f)
                box = json.loads(f_dict['box_json']) if 'box_json' in f_dict and f_dict['box_json'] else "N/A"
                
                print(f"\n[Face ID: {f_dict['id']}]")
                print(f"  Score: {f_dict.get('score')}")
                print(f"  Status: {'IGNORED' if f_dict.get('is_ignored') else 'ACTIVE'}")
                print(f"  Type: {f_dict.get('entity_type', 'N/A')}")
                print(f"  VLM Desc: {f_dict.get('vlmDescription', 'N/A')}")
                print(f"  Box: {box}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    analyze_targets()
