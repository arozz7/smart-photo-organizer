"""
Quick schema inspector for photos table
"""
import sqlite3

DB_PATH = r"H:\DevWork\smart-photo-organizer\library.db"

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Get photos table schema
cursor.execute("PRAGMA table_info(photos)")
columns = cursor.fetchall()
print("📊 Photos table columns:")
for col in columns:
    print(f"   - {col[1]} ({col[2]})")

print("\n" + "="*80 + "\n")

# Get faces table schema
cursor.execute("PRAGMA table_info(faces)")
columns = cursor.fetchall()
print("📊 Faces table columns:")
for col in columns:
    print(f"   - {col[1]} ({col[2]})")

print("\n" + "="*80 + "\n")

# Get face_vlm_verifications table schema (if exists)
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='face_vlm_verifications'")
if cursor.fetchone():
    cursor.execute("PRAGMA table_info(face_vlm_verifications)")
    columns = cursor.fetchall()
    print("📊 face_vlm_verifications table columns:")
    for col in columns:
        print(f"   - {col[1]} ({col[2]})")

conn.close()
