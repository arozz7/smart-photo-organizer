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

    # Targets
    target_ids = [222, 223, 226, 227, 230] 
    # 222, 223: original
    # 226, 227: pexels-filiamariss (from log search)
    # 230: pexels-polina-tankilevitch
    
    id_list = ','.join(map(str, target_ids))
    
    print(f"Remediating faces: {id_list}")
    
    cursor.execute(f"UPDATE faces SET is_ignored = 0, entity_type = 'suspect', verification_attempts = 0 WHERE id IN ({id_list})")
    print(f"Rows updated: {cursor.rowcount}")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    remediate()
