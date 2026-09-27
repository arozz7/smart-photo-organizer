/**
 * Tool (not a behaviour test): scanner benchmark. Skipped unless SCAN_BENCH=1.
 * See scripts/bench/scan-bench.ts for options.
 */
import { describe, it, expect } from 'vitest';
import { runScanBench } from '../../scripts/bench/scan-bench';

const numberFromEnv = (name: string): number | undefined => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
};

describe.skipIf(process.env.SCAN_BENCH !== '1')('scanner benchmark', () => {
    it('reports timings and every ingested photo is complete', async () => {
        const files = numberFromEnv('SCAN_BENCH_FILES') ?? 500;
        const photoSized = process.env.SCAN_BENCH_SIZE === 'photo';

        const result = await runScanBench({
            files,
            foldersCount: 10,
            width: photoSized ? 3000 : undefined,
            height: photoSized ? 2000 : undefined,
            concurrency: numberFromEnv('SCAN_BENCH_CONCURRENCY'),
            exiftoolProcesses: numberFromEnv('SCAN_BENCH_PROCS'),
        });

        console.log(`[bench] ${JSON.stringify(result)}`);
        expect(result.verification).toEqual({
            rows: files, emptyMetadata: 0, missingDimensions: 0, missingHash: 0, missingPreviewFile: 0,
        });
    }, 900_000);
});
