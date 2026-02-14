
import sqlite3
import os

db_path = r"H:\DevWork\smart-photo-organizer\library.db"

def check_ignored_faces():
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("--- Ignored Faces (is_ignored=1) ---")
    try:
        cursor.execute("SELECT id, photo_id, box_json, score, face_quality, session_date FROM faces WHERE is_ignored=1 ORDER BY id DESC LIMIT 20")
        rows = cursor.fetchall()
        for row in rows:
            print(f"ID: {row[0]}, PhotoID: {row[1]}, Score: {row[3]}, Quality: {row[4]}, Date: {row[5]}")
            # print(f"  Box: {row[2]}")
    except Exception as e:
        print(f"Error querying faces: {e}")

    print("\n--- Faces with 'Fail Open' Reason (if recorded) ---")
    # Reasons are not stored in DB column 'reason' usually, but let's check if there's a way to infer.
    # Actually, BackgroundVerificationService updates 'is_confirmed' or 'assignment_source', but reason is logged.
    # We can check assignment_source for 'split_multiface' which was another recent change.
    
    print("\n--- Split Multi-Face Assignments ---")
    try:
        cursor.execute("SELECT id, photo_id, score FROM faces WHERE assignment_source='split_multiface' ORDER BY id DESC LIMIT 10")
        rows = cursor.fetchall()
        for row in rows:
            print(f"ID: {row[0]}, PhotoID: {row[1]}, Score: {row[2]}")
    except Exception as e:
        print(f"Error querying split faces: {e}")

    conn.close()

if __name__ == "__main__":
    check_ignored_faces()
