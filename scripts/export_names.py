import sqlite3
import os

# Database path specified by the user
DB_PATH = r"M:\Test\smart-photo-organizer-realTest\library.db"
OUTPUT_FILE = "named_persons.txt"

def main():
    print(f"Attempting to connect to database at: {DB_PATH}")
    
    if not os.path.exists(DB_PATH):
        print(f"Error: Database file not found at {DB_PATH}")
        print("Please verify the drive M: is mounted and the path is correct.")
        return

    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Query for all names from the 'people' table
        print("Querying for named persons...")
        cursor.execute("SELECT name FROM people WHERE name IS NOT NULL ORDER BY name ASC")
        rows = cursor.fetchall()
        
        if not rows:
            print("No named persons found in the database.")
            return

        # Write names to the output file
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            for row in rows:
                name = row[0]
                if name:
                    f.write(name + "\n")
                    
        print(f"Successfully exported {len(rows)} names to '{os.path.abspath(OUTPUT_FILE)}'")
        
    except sqlite3.Error as e:
        print(f"SQLite Error: {e}")
    except IOError as e:
        print(f"File I/O Error: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()
