/**
 * How many faces still wait to be grouped (unassigned, not ignored, marked as needing grouping). The Review Needed progress asks this every
 * second while grouping runs, so migration 009 gives it an index that answers it without reading the faces (each carries a large descriptor).
 * The migration test checks this exact text against that index.
 */
export const REMAINING_BUCKETING_SQL = 'SELECT COUNT(*) as count FROM faces WHERE needs_bucketing = 1 AND person_id IS NULL AND is_ignored = 0';
