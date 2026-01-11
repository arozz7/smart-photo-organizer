import { getDB } from '../../db';

/**
 * AppStateRepository - Manages app-wide state flags and checkpoints for background services.
 * 
 * Used by BackgroundBucketingService and shutdown protocol.
 */
export class AppStateRepository {
    /**
     * Get a single state flag value.
     */
    static getFlag(key: string): string | null {
        const db = getDB();
        const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string | null } | undefined;
        return row?.value ?? null;
    }

    /**
     * Set a state flag value.
     */
    static setFlag(key: string, value: string | null): void {
        const db = getDB();
        db.prepare(`
            INSERT INTO app_state (key, value, updated_at) 
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(key, value);
    }

    /**
     * Check if a scan is currently in progress.
     */
    static isScanActive(): boolean {
        return this.getFlag('scan_in_progress') === '1';
    }

    /**
     * Check if scanning is paused.
     */
    static isScanPaused(): boolean {
        return this.getFlag('scan_paused') === '1';
    }

    /**
     * Check if bucketing has dirty data that needs processing.
     */
    static isBucketingDirty(): boolean {
        return this.getFlag('bucketing_dirty') === '1';
    }

    /**
     * Check if shutdown has been requested.
     */
    static isShutdownRequested(): boolean {
        return this.getFlag('shutdown_requested') === '1';
    }

    /**
     * Get the current bucketing checkpoint offset.
     */
    static getBucketingOffset(): number {
        const val = this.getFlag('bucketing_checkpoint_offset');
        return val ? parseInt(val, 10) : 0;
    }

    /**
     * Set the bucketing checkpoint offset.
     */
    static setBucketingOffset(offset: number): void {
        this.setFlag('bucketing_checkpoint_offset', String(offset));
    }

    /**
     * Get the total faces to bucket (for progress display).
     */
    static getBucketingTotal(): number {
        const val = this.getFlag('bucketing_total');
        return val ? parseInt(val, 10) : 0;
    }

    /**
     * Set the total faces to bucket.
     */
    static setBucketingTotal(total: number): void {
        this.setFlag('bucketing_total', String(total));
    }

    /**
     * Mark scan as started.
     */
    static startScan(): void {
        this.setFlag('scan_in_progress', '1');
    }

    /**
     * Mark scan as completed.
     */
    static endScan(): void {
        this.setFlag('scan_in_progress', '0');
        this.setFlag('bucketing_dirty', '1');
    }

    /**
     * Request graceful shutdown.
     */
    static requestShutdown(): void {
        this.setFlag('shutdown_requested', '1');
    }

    /**
     * Clear shutdown request (on clean restart).
     */
    static clearShutdownRequest(): void {
        this.setFlag('shutdown_requested', '0');
    }

    /**
     * Record clean shutdown timestamp.
     */
    static recordCleanShutdown(): void {
        this.setFlag('last_clean_shutdown', new Date().toISOString());
    }

    /**
     * Check if last shutdown was clean.
     */
    static wasLastShutdownClean(): boolean {
        return this.getFlag('last_clean_shutdown') !== null;
    }

    /**
     * Mark bucketing dirty flag for processing.
     */
    static markBucketingDirty(): void {
        this.setFlag('bucketing_dirty', '1');
    }

    /**
     * Clear bucketing dirty flag after processing.
     */
    /**
     * Clear bucketing dirty flag after processing.
     */
    static clearBucketingDirty(): void {
        this.setFlag('bucketing_dirty', '0');
    }

    // --- Phase B5: Ignored Re-check ---

    static isRecheckActive(): boolean {
        return this.getFlag('ignored_recheck_active') === '1';
    }

    static setRecheckActive(active: boolean): void {
        this.setFlag('ignored_recheck_active', active ? '1' : '0');
    }

    static getRecheckOffset(): number {
        const val = this.getFlag('ignored_recheck_offset');
        return val ? parseInt(val, 10) : 0;
    }

    static setRecheckOffset(offset: number): void {
        this.setFlag('ignored_recheck_offset', String(offset));
    }

    static getRecheckTotal(): number {
        const val = this.getFlag('ignored_recheck_total');
        return val ? parseInt(val, 10) : 0;
    }

    static setRecheckTotal(total: number): void {
        this.setFlag('ignored_recheck_total', String(total));
    }
}
