"""
Check for ignored faces in both potential databases
"""
import sqlite3
import os

DB_PATHS = [
    r"H:\DevWork\smart-photo-organizer\library.db",
    r"J:\Projects\smart-photo-organizer\library.db"
]

def check_dbs():
    for db_path in DB_PATHS:
        if not os.path.exists(db_path):
            print(f"\n❌ DB not found: {db_path}")
            continue
            
        print(f"\n🔍 Checking DB: {db_path}")
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # List tables
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row['name'] for row in cursor.fetchall()]
            # print(f"   Tables: {tables}")
            
            if 'photos' in tables:
                print("   ✅ Found 'photos' table!")
                # Find the photo
                cursor.execute("SELECT id, file_path FROM photos WHERE file_path LIKE ?", ('%Girl duo%',))
                photo = cursor.fetchone()
                if photo:
                    print(f"   📸 Found photo: {photo['file_path']}")
                    print(f"      ID: {photo['id']}")
                    
                    cursor.execute("SELECT * FROM faces WHERE photo_id = ?", (photo['id'],))
                    faces = cursor.fetchall()
                    print(f"      Faces count: {len(faces)}")
                    for face in faces:
                        status = "🚫 IGNORED" if face['is_ignored'] else "✅ ACTIVE"
                        print(f"      - Face {face['id']} [{status}]: entity={face['entity_type']}, score={face['score']}")
                else:
                    print("   ⚠️  Photo 'Girl duo' not found in this DB")
            else:
                print("   ❌ No 'photos' table")
                
            conn.close()
        except Exception as e:
            print(f"   ❌ Error checking DB: {e}")

if __name__ == "__main__":
    check_dbs()
