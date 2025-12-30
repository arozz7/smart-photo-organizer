
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Path to user's DB. Usually in AppData.
// User metadata shows project path: j:\Projects\smart-photo-organizer
// The app likely uses a standard location or local file.
// I'll check 'electron/db.ts' to see where it initializes the DB.
// Assuming default location: C:\Users\arozz\AppData\Roaming\Smart Photo Organizer\database.sqlite
// Or from logs: C:\Users\arozz\AppData\Local\Temp...
// I'll assume standard AppData.
const appData = path.join(os.homedir(), 'AppData', 'Roaming', 'Smart Photo Organizer');
const dbPath = path.join(appData, 'database.sqlite');

console.log('Checking DB at:', dbPath);

try {
    const db = new Database(dbPath, { readonly: true });

    // Check count of photos with NULL width
    const nullWidthCount = db.prepare('SELECT COUNT(*) as count FROM photos WHERE width IS NULL').get().count;
    console.log('Photos with NULL width:', nullWidthCount);

    // Check count of RAW photos
    const rawCount = db.prepare("SELECT COUNT(*) as count FROM photos WHERE lower(file_path) LIKE '%.nef' OR lower(file_path) LIKE '%.arw'").get().count;
    console.log('RAW Photos count:', rawCount);

    // Check sample RAW photo
    const sample = db.prepare("SELECT id, file_path, width, height, preview_cache_path FROM photos WHERE width IS NULL AND (lower(file_path) LIKE '%.nef' OR lower(file_path) LIKE '%.arw') LIMIT 1").get();

    if (sample) {
        console.log('Sample RAW photo with NULL width:', sample);
    } else {
        const anyRaw = db.prepare("SELECT id, file_path, width, height FROM photos WHERE lower(file_path) LIKE '%.nef' OR lower(file_path) LIKE '%.arw' LIMIT 1").get();
        console.log('Sample RAW photo (any):', anyRaw);
    }

    // Check faces linked to these photos
    if (sample) {
        const face = db.prepare('SELECT * FROM faces WHERE photo_id = ?').get(sample.id);
        console.log('Face for sample:', face);
    }

} catch (e) {
    console.error('Database check failed:', e);
}
