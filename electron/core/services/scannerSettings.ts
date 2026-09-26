import { z } from 'zod';

/** Tunables for library scanning. Stored under `scanner` in config.json; all fields optional there. */
export interface ScannerSettings {
    /** Files processed at once. */
    concurrency: number;
    /** ExifTool worker processes (each read is ~30 ms, so more processes overlap them). */
    exiftoolProcesses: number;
}

const MAX_WORKERS = 16;

/**
 * Defaults measured on a 500-file scan: 1 ExifTool process 19.5 ms/file, 2 -> 12.2, 4 -> 10.4, 8 -> 9.8.
 * Concurrency stays at 4 because decoding several large photos at once is memory-hungry.
 */
export function defaultScannerSettings(cpuCount: number): ScannerSettings {
    return {
        concurrency: 4,
        exiftoolProcesses: Math.min(4, Math.max(1, Math.floor(cpuCount / 2))),
    };
}

const workerCount = z.number().int().min(1).max(MAX_WORKERS).optional().catch(undefined);

const overridesSchema = z.object({ concurrency: workerCount, exiftoolProcesses: workerCount }).catch({});

/** Applies user overrides on top of the defaults. Anything invalid is ignored (never throws). */
export function resolveScannerSettings(overrides: unknown, cpuCount: number): ScannerSettings {
    const defaults = defaultScannerSettings(cpuCount);
    const parsed = overridesSchema.parse(overrides);

    return {
        concurrency: parsed.concurrency ?? defaults.concurrency,
        exiftoolProcesses: parsed.exiftoolProcesses ?? defaults.exiftoolProcesses,
    };
}
