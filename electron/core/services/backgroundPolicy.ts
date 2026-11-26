import type { AISettings } from './ConfigService';

/**
 * How long after the last face-scan work the background tasks (face checks, grouping, descriptions and tags, ...) keep waiting.
 * The scan's busy flag drops for a moment between two photos, and the engine answers one request at a time, so a task that
 * starts in that gap makes the next photo wait behind it. The wait must be longer than that gap.
 */
export const BACKGROUND_WAIT_AFTER_SCAN_MS = 15_000;

/** Zero when the user lets background tasks run alongside the scan (slower scan), otherwise the usual wait. */
export function backgroundIdleGraceMs(settings: Pick<AISettings, 'backgroundDuringScan'>): number {
    return settings.backgroundDuringScan ? 0 : BACKGROUND_WAIT_AFTER_SCAN_MS;
}
