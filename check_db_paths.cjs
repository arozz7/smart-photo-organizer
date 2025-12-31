const Database = require('better-sqlite3');
const path = require('path');

// DB Path
const dbPath = 'M:\\Test\\smart-photo-organizer\\library.db';

try {
    const db = new Database(dbPath, { readonly: true });

    // Check for _DSC7104.ARW (The one we fixed first) and _DSC7216.ARW (The new example)
    const files = ['%_DSC7104.ARW%', '%_DSC7216.ARW%'];

    files.forEach(f => {
        const stmt = db.prepare("SELECT id, file_path, preview_cache_path FROM photos WHERE file_path LIKE ?");
        const results = stmt.all(f);

        console.log(`\nRecords for ${f}:`);
        results.forEach(r => {
            console.log(`ID: ${r.id}`);
            console.log(`File: ${r.file_path}`);
            console.log(`Preview: ${r.preview_cache_path}`);
        });
    });

} catch (e) {
    console.error("DB Error:", e);
}
