const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Adjust if user is using a custom library path, but this is the default location
const dbPath = 'M:\\Test\\smart-photo-organizer\\library.db';

try {
    console.log(`Checking DB at: ${dbPath}`);
    const db = new Database(dbPath, { readonly: true });

    const total = db.prepare('SELECT COUNT(*) as count FROM faces').get().count;
    const unassigned = db.prepare('SELECT COUNT(*) as count FROM faces WHERE person_id IS NULL').get().count;
    const unassignedWithDesc = db.prepare('SELECT COUNT(*) as count FROM faces WHERE person_id IS NULL AND descriptor IS NOT NULL').get().count;
    const ignored = db.prepare('SELECT COUNT(*) as count FROM faces WHERE is_ignored = 1').get().count;
    const unassignedNotIgnored = db.prepare('SELECT COUNT(*) as count FROM faces WHERE person_id IS NULL AND descriptor IS NOT NULL AND (is_ignored = 0 OR is_ignored IS NULL)').get().count;

    console.log('--- DB Stats ---');
    console.log(`Total Faces: ${total}`);
    console.log(`Unassigned (Total): ${unassigned}`);
    console.log(`Unassigned (Has Descriptor): ${unassignedWithDesc}`);
    console.log(`Ignored: ${ignored}`);
    console.log(`Candidates for Grouping (Unassigned + Desc + Not Ignored): ${unassignedNotIgnored}`);
    console.log('----------------');

} catch (e) {
    console.error('Failed to open DB:', e.message);
}
