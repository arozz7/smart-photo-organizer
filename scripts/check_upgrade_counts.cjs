const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join('H:', 'DevWork', 'smart-photo-organizer', 'library.db');
const db = new Database(dbPath, { readonly: true });

console.log('Checking Face Data Upgrade Counts...');

try {
    const total = db.prepare('SELECT COUNT(*) as count FROM faces').get().count;
    console.log(`Total Faces: ${total}`);

    const eligible = db.prepare(`
        SELECT COUNT(*) as count FROM faces 
        WHERE descriptor IS NOT NULL
          AND (is_ignored = 0 OR is_ignored IS NULL)
          AND (blur_score IS NULL OR blur_score >= 10)
    `).get().count;
    console.log(`Eligible Faces: ${eligible}`);

    const needingUpgrade = db.prepare(`
        SELECT COUNT(*) as count FROM faces 
        WHERE descriptor IS NOT NULL
          AND (is_ignored = 0 OR is_ignored IS NULL)
          AND (blur_score IS NULL OR blur_score >= 10)
          AND (pose_yaw IS NULL OR descriptor_v2 IS NULL)
    `).get().count;
    console.log(`Needing Upgrade: ${needingUpgrade}`);

    if (needingUpgrade > 0) {
        // Show sample
        const sample = db.prepare(`
            SELECT id, pose_yaw, descriptor_v2 
            FROM faces 
            WHERE descriptor IS NOT NULL
              AND (is_ignored = 0 OR is_ignored IS NULL)
              AND (blur_score IS NULL OR blur_score >= 10)
              AND (pose_yaw IS NULL OR descriptor_v2 IS NULL)
            LIMIT 5
        `).all();
        console.log('Sample needing upgrade:', sample);
    }

} catch (e) {
    console.error('Error:', e);
}
