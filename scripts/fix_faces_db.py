import sqlite3
import os

DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"

def fix_db():
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # IDs identified from debug_db.py output
    # NUCLEAR OPTION: Delete ALL faces for Photo 54
    # The user reports persistent ghosts despite specific deletions.
    # We wipe the slate clean to verify DB connection and force 100% fresh scan.
    
    # NUCLEAR OPTION: Delete ALL faces for Photo 55
    # The debug logs confirmed over 50+ faces piled up for ID 55.
    # We wipe them all.
    
    photo_id = 55
    print(f"NUCLEAR OPTION: Deleting ALL faces for Photo ID {photo_id} from {DB_PATH}")
    
    face_table = "faces"

    try:
        cursor.execute(f"DELETE FROM {face_table} WHERE photo_id = ?", (photo_id,))
        deleted_count = cursor.rowcount
        conn.commit()
        print(f"Successfully deleted {deleted_count} faces (ALL of them).")
    except Exception as e:
        print(f"Error deleting: {e}")
        conn.rollback()
    
    conn.close()

if __name__ == "__main__":
    fix_db()
