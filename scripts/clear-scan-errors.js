// One-time script to clear scan_errors table
const Database = require('better-sqlite3');

const dbPath = 'H:\\\\DevWork\\\\smart-photo-organizer\\\\library.db';

console.log(`Connecting to database: ${dbPath}`);
const db = new Database(dbPath);

// Check current count
const beforeCount = db.prepare('SELECT COUNT(*) as count FROM scan_errors').get();
console.log(`Current scan_errors count: ${beforeCount.count}`);

// Clear the table
db.prepare('DELETE FROM scan_errors').run();

// Verify
const afterCount = db.prepare('SELECT COUNT(*) as count FROM scan_errors').get();
console.log(`After clearing: ${afterCount.count}`);

db.close();
console.log('✅ scan_errors table cleared successfully');
