import sqlite3
import os

# DB Path
DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"

def remediate():
    if not os.path.exists(DB_PATH):
        print(f"DB not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Targets: Find by filename pattern
    patterns = ['%tankilevitch%', '%filiamariss%']
    
    target_ids = []
    
    print("Searching for target faces...")
    for pat in patterns:
        cursor.execute("""
            SELECT f.id, p.file_path, f.entity_type, f.is_ignored 
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE p.file_path LIKE ?
        """, (pat,))
        
        rows = cursor.fetchall()
        for r in rows:
            print(f"Found: ID={r[0]}, Path={os.path.basename(r[1])}, Type={r[2]}, Ignored={r[3]}")
            target_ids.append(r[0])
            
    if not target_ids:
        print("No faces found matching patterns.")
        return

    id_list = ','.join(map(str, target_ids))
    
    print(f"\nRemediating faces: {id_list}")
    
    # Reset to 'suspect' to trigger VLM & Split Check
    cursor.execute(f"UPDATE faces SET is_ignored = 0, entity_type = 'suspect', verification_attempts = 0 WHERE id IN ({id_list})")
    print(f"Rows updated: {cursor.rowcount}")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    remediate()
