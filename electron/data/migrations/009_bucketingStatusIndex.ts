import type { Migration } from './types';

/**
 * An index that answers "how many faces still wait to be grouped" without reading the faces. The Review Needed progress asks every second while
 * grouping runs; without this index the count read every unassigned face (about 90,000, each with a large descriptor) and took about 0.3 s of the
 * main process each time, a third of its time. The index holds only the three small columns the question uses. Additive: one new index.
 */
export const bucketingStatusIndexMigration: Migration = {
    version: 9,
    name: 'bucketing_status_index',
    up(db) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_faces_bucketing_status ON faces (needs_bucketing, person_id, is_ignored)');
    },
};
