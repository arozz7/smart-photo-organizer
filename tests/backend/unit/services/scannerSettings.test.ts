import { describe, it, expect } from 'vitest';
import { defaultScannerSettings, exiftoolTaskTimeoutMs, resolveScannerSettings } from '../../../../electron/core/services/scannerSettings';

describe('defaultScannerSettings', () => {
    it.each([
        [1, 1],
        [2, 1],
        [4, 2],
        [8, 4],
        [28, 4],
    ])('on %i CPU cores uses %i ExifTool processes', (cores, procs) => {
        expect(defaultScannerSettings(cores).exiftoolProcesses).toBe(procs);
    });

    it('keeps file concurrency at 4 regardless of cores (decoding large photos is memory-hungry)', () => {
        expect(defaultScannerSettings(2).concurrency).toBe(4);
        expect(defaultScannerSettings(64).concurrency).toBe(4);
    });
});

describe('resolveScannerSettings', () => {
    it('uses defaults when nothing is configured', () => {
        expect(resolveScannerSettings(undefined, 8)).toEqual({ concurrency: 4, exiftoolProcesses: 4 });
    });

    it('applies valid overrides per field', () => {
        expect(resolveScannerSettings({ concurrency: 8 }, 8)).toEqual({ concurrency: 8, exiftoolProcesses: 4 });
        expect(resolveScannerSettings({ concurrency: 2, exiftoolProcesses: 1 }, 8)).toEqual({ concurrency: 2, exiftoolProcesses: 1 });
    });

    it.each([0, -1, 1.5, 999, Number.NaN, '4', null])('ignores the invalid value %s and falls back to the default', bad => {
        expect(resolveScannerSettings({ concurrency: bad, exiftoolProcesses: bad }, 8)).toEqual({ concurrency: 4, exiftoolProcesses: 4 });
    });

    it('falls back to defaults for a value that is not an object', () => {
        expect(resolveScannerSettings('nonsense', 8)).toEqual({ concurrency: 4, exiftoolProcesses: 4 });
        expect(resolveScannerSettings(42, 8)).toEqual({ concurrency: 4, exiftoolProcesses: 4 });
    });

    it('accepts the documented maximum of 16 and rejects 17', () => {
        expect(resolveScannerSettings({ concurrency: 16 }, 8).concurrency).toBe(16);
        expect(resolveScannerSettings({ concurrency: 17 }, 8).concurrency).toBe(4);
    });
});

describe('exiftoolTaskTimeoutMs', () => {
    // ExifTool starts a task's clock when it is queued, so queue wait must be budgeted
    it.each([
        [{ concurrency: 4, exiftoolProcesses: 4 }, 5000],
        [{ concurrency: 1, exiftoolProcesses: 1 }, 5000],
        [{ concurrency: 4, exiftoolProcesses: 1 }, 20000],
        [{ concurrency: 4, exiftoolProcesses: 2 }, 10000],
        [{ concurrency: 5, exiftoolProcesses: 2 }, 15000],
        [{ concurrency: 2, exiftoolProcesses: 4 }, 5000],
    ])('%o -> %i ms', (settings, expected) => {
        expect(exiftoolTaskTimeoutMs(settings)).toBe(expected);
    });
});
