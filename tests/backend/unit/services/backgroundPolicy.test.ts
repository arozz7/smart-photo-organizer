import { describe, it, expect } from 'vitest';
import { backgroundIdleGraceMs, BACKGROUND_WAIT_AFTER_SCAN_MS } from '../../../../electron/core/services/backgroundPolicy';

describe('backgroundPolicy', () => {
    it('makes background work wait for the face scan by default', () => {
        expect(backgroundIdleGraceMs({})).toBe(BACKGROUND_WAIT_AFTER_SCAN_MS);
        expect(backgroundIdleGraceMs({ backgroundDuringScan: false })).toBe(BACKGROUND_WAIT_AFTER_SCAN_MS);
    });

    it('lets it run alongside the scan only when asked to', () => {
        expect(backgroundIdleGraceMs({ backgroundDuringScan: true })).toBe(0);
    });

    it('waits long enough to bridge the pause between two photos of a scan', () => {
        expect(BACKGROUND_WAIT_AFTER_SCAN_MS).toBeGreaterThanOrEqual(10_000);
    });
});
