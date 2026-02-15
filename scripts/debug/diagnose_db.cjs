const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'M:\\Test\\smart-photo-organizer\\library.db'; // Based on logs
const db = new Database(dbPath, { readonly: true });

console.log('--- DIAGNOSTICS ---');

// 1. Check Scan Errors for Protocol issues
try {
    const errors = db.prepare('SELECT * FROM scan_errors ORDER BY created_at DESC LIMIT 5').all();
    console.log('Recent Scan Errors:', errors);
} catch (e) {
    console.log('Error reading scan_errors:', e.message);
}

// 2. Check RAW Photo Previews
try {
    const rawPhoto = db.prepare("SELECT id, file_path, preview_cache_path, width, height FROM photos WHERE file_path LIKE '%.NEF' OR file_path LIKE '%.ARW' OR file_path LIKE '%.CR2' LIMIT 1").get();
    console.log('Sample RAW Photo:', rawPhoto);
} catch (e) {
    console.log('Error reading photos:', e.message);
}

// 3. Check Face Stats
try {
    const totalFaces = db.prepare('SELECT COUNT(*) as c FROM faces').get().c;
    const assignedFaces = db.prepare('SELECT COUNT(*) as c FROM faces WHERE person_id IS NOT NULL').get().c;
    const unassignedFaces = db.prepare('SELECT COUNT(*) as c FROM faces WHERE person_id IS NULL').get().c;
    const peopleCount = db.prepare('SELECT COUNT(*) as c FROM people').get().c;

    console.log('Face Stats:', { totalFaces, assignedFaces, unassignedFaces, peopleCount });
} catch (e) {
    console.log('Error reading face stats:', e.message);
}

console.log('--- END DIAGNOSTICS ---');
db.close();
