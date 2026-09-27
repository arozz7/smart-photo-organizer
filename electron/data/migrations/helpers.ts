import type Database from 'better-sqlite3';

/**
 * ALTER TABLE ... ADD COLUMN only if the column is not there yet (SQLite has no IF NOT EXISTS for it).
 * Makes a migration safe to re-run. `definition` is a trusted constant, never user input.
 */
export function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
    const existing = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(c => c.name);
    if (!existing.includes(column)) {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    }
}
