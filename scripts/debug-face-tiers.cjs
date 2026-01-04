
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'M:/Test/smart-photo-organizer/library.db';
console.log(`Debug Script: Opening DB at ${dbPath}`);

try {
    const db = new Database(dbPath, { readonly: true });

    // 1. Check Totals
    const totalFaces = db.prepare('SELECT COUNT(*) as c FROM faces').get().c;
    const unknownTiers = db.prepare("SELECT COUNT(*) as c FROM faces WHERE confidence_tier = 'unknown' OR confidence_tier IS NULL").get().c;
    const reviewTiers = db.prepare("SELECT COUNT(*) as c FROM faces WHERE confidence_tier = 'review'").get().c;
    const highTiers = db.prepare("SELECT COUNT(*) as c FROM faces WHERE confidence_tier = 'high'").get().c;

    console.log('--- DB Stats ---');
    console.log(`Total Faces: ${totalFaces}`);
    console.log(`Unknown Tier: ${unknownTiers}`);
    console.log(`Review Tier: ${reviewTiers}`);
    console.log(`High Tier: ${highTiers}`);

    // 2. Dump a few examples of non-unknown faces if any
    if (reviewTiers > 0 || highTiers > 0) {
        const examples = db.prepare("SELECT id, person_id, confidence_tier, suggested_person_id, match_distance FROM faces WHERE confidence_tier IN ('review', 'high') LIMIT 5").all();
        console.log('\n--- Examples (Review/High) ---');
        console.table(examples);
    } else {
        // 3. Dump a few unknown examples to see their match_distance
        const examples = db.prepare("SELECT id, person_id, confidence_tier, suggested_person_id, match_distance FROM faces WHERE person_id IS NULL LIMIT 10").all();
        console.log('\n--- Examples (Unknown/Unassigned) ---');
        console.table(examples);
    }

} catch (e) {
    console.error('Debug failed:', e);
}
