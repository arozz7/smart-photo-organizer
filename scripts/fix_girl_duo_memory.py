"""
Clear ignored faces for 'Girl duo' to allow re-verification
"""
import sqlite3
import os

DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"

def fix_girl_duo():
    if not os.path.exists(DB_PATH):
        print(f"❌ DB not found: {DB_PATH}")
        return

    print(f"🔍 Connecting to: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Find the photo
    cursor.execute("SELECT id, file_path FROM photos WHERE file_path LIKE ?", ('%Girl duo%',))
    photo = cursor.fetchone()
    
    if not photo:
        print("❌ 'Girl duo' photo not found")
        return

    print(f"📸 Found photo: {photo['file_path']} (ID: {photo['id']})")
    
    # Check for ignored faces
    cursor.execute("SELECT * FROM faces WHERE photo_id = ? AND is_ignored = 1", (photo['id'],))
    ignored = cursor.fetchall()
    
    print(f"found {len(ignored)} ignored faces.")
    
    if len(ignored) > 0:
        print("🧹 Clearing ignored status for these faces...")
        # We delete them so they can be re-detected as fresh faces
        # Or we could set is_ignored=0, but re-detection is cleaner given the box might be slightly different
        cursor.execute("DELETE FROM faces WHERE photo_id = ? AND is_ignored = 1", (photo['id'],))
        conn.commit()
        print("✅ Ignored faces deleted. Rescan should now find them and send to VLM.")
    else:
        print("ℹ️ No ignored faces to clear.")

    conn.close()

if __name__ == "__main__":
    fix_girl_duo()
