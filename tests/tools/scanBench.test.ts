/**
 * Tool (not a behaviour test): scanner benchmark. Skipped unless SCAN_BENCH=1.
 * See scripts/bench/scan-bench.ts.
 */
import { describe, it, expect } from 'vitest';
import { runScanBench } from '../../scripts/bench/scan-bench';

describe.skipIf(process.env.SCAN_BENCH !== '1')('scanner benchmark', () => {
    it('reports ingest and unchanged-rescan timings', async () => {
        const files = Number(process.env.SCAN_BENCH_FILES ?? 500);

        const result = await runScanBench({ files, foldersCount: 10 });

        console.log(`[bench] ${JSON.stringify(result)}`);
        expect(result.files).toBe(files);
    }, 600_000);
});
