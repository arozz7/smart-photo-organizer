const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// DB Path (guessed from logs/context)
const dbPath = 'M:\\Test\\smart-photo-organizer\\library.db';
// Or use the one from config, but let's try the default location based on previous logs

console.log(`Checking DB at: ${dbPath}`);

try {
    const db = new Database(dbPath, { readonly: true });

    // Check for _DSC7104.ARW
    const stmt = db.prepare("SELECT id, file_path, preview_cache_path FROM photos WHERE file_path LIKE '%_DSC7104.ARW%'");
    const results = stmt.all();

    console.log(`Found ${results.length} records for _DSC7104.ARW:`);

    results.forEach(r => {
        console.log('---');
        console.log(`ID: ${r.id}`);
        console.log(`File Path: ${r.file_path}`);
        console.log(`DB Preview Path: ${r.preview_cache_path}`);

        // Calculate Expected Hash
        const hash = crypto.createHash('md5').update(r.file_path).digest('hex');
        console.log(`Expected Hash (md5(file_path)): ${hash}`);
        console.log(`Expected Preview Name: ${hash}.jpg`);
    });

} catch (e) {
    console.error("DB Error:", e);
}
