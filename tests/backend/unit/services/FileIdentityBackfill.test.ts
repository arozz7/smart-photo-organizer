import { describe, it, expect, vi } from 'vitest';
import { FileIdentityBackfill } from '../../../../electron/core/services/FileIdentityBackfill';
import type { FileIdentity } from '../../../../electron/scanning/fileIdentity';

const identityFor = (id: number): FileIdentity => ({ size: id * 10, mtime: id * 1000, fileId: `1:${id}` });

/** In-memory stand-in for the repository: photos with ids 1..count, none recorded yet. */
const makeRepository = (count: number) => {
    const pending = new Set(Array.from({ length: count }, (_, i) => i + 1));
    const saved: { id: number; identity: FileIdentity }[][] = [];
    return {
        saved,
        getPhotosNeedingIdentity: vi.fn((afterId: number, limit: number) =>
            [...pending].filter(id => id > afterId).sort((a, b) => a - b).slice(0, limit).map(id => ({ id, file_path: `p${id}.jpg` }))),
        setIdentityBatch: vi.fn((entries: { id: number; identity: FileIdentity }[]) => {
            saved.push(entries);
            entries.forEach(e => pending.delete(e.id));
        }),
    };
};

const noSleep = async () => undefined;

describe('FileIdentityBackfill', () => {
    it('fills in every photo, in batches, and reports how many', async () => {
        // Arrange
        const repo = makeRepository(5);
        const backfill = new FileIdentityBackfill({
            repository: repo,
            readIdentity: async file => identityFor(Number(/p(\d+)/.exec(file)![1])),
            isBusy: () => false,
            sleep: noSleep,
            batchSize: 2,
        });

        // Act
        const result = await backfill.run();

        // Assert
        expect(result).toEqual({ updated: 5, unreadable: 0 });
        expect(repo.saved.map(batch => batch.map(e => e.id))).toEqual([[1, 2], [3, 4], [5]]);
        expect(repo.saved[0][0].identity).toEqual(identityFor(1));
    });

    it('passes over unreadable files once instead of retrying them forever', async () => {
        // Arrange
        const repo = makeRepository(4);
        const backfill = new FileIdentityBackfill({
            repository: repo,
            readIdentity: async file => (file === 'p2.jpg' ? null : identityFor(1)), // p2 cannot be read
            isBusy: () => false,
            sleep: noSleep,
            batchSize: 10,
        });

        // Act
        const result = await backfill.run();

        // Assert
        expect(result).toEqual({ updated: 3, unreadable: 1 });
        // one page of 4, then one more query (after id 4) that finds nothing: p2 was not asked for again
        expect(repo.getPhotosNeedingIdentity).toHaveBeenCalledTimes(2);
    });

    it('waits while a scan or AI work is running, and does not query the database meanwhile', async () => {
        // Arrange
        const repo = makeRepository(1);
        let busyChecks = 0;
        const sleep = vi.fn(async () => undefined);
        const sleepsBeforeFirstQuery: number[] = [];
        const originalQuery = repo.getPhotosNeedingIdentity.getMockImplementation()!;
        repo.getPhotosNeedingIdentity.mockImplementation((afterId: number, limit: number) => {
            sleepsBeforeFirstQuery.push(sleep.mock.calls.length);
            return originalQuery(afterId, limit);
        });
        const backfill = new FileIdentityBackfill({
            repository: repo,
            readIdentity: async () => identityFor(1),
            isBusy: () => ++busyChecks <= 3, // busy for the first three checks
            sleep,
            batchSize: 10,
        });

        // Act
        await backfill.run();

        // Assert: it had slept through all three busy checks before the first database query
        expect(sleepsBeforeFirstQuery[0]).toBe(3);
        expect(repo.saved).toHaveLength(1);
    });

    it('stops promptly when asked, keeping what was already saved', async () => {
        // Arrange
        const repo = makeRepository(6);
        const backfill = new FileIdentityBackfill({
            repository: repo,
            readIdentity: async () => identityFor(1),
            isBusy: () => false,
            sleep: async () => { backfill.stop(); }, // stop requested during the pause after the first batch
            batchSize: 2,
        });

        // Act
        const result = await backfill.run();

        // Assert
        expect(result.updated).toBe(2);
        expect(repo.saved).toHaveLength(1);
    });

    it('exits (instead of waiting) when the app is shutting down, even while it would otherwise be busy', async () => {
        // Arrange
        const repo = makeRepository(4);
        let aborted = false;
        const backfill = new FileIdentityBackfill({
            repository: repo,
            readIdentity: async () => identityFor(1),
            isBusy: () => true, // scans/AI would keep it waiting forever...
            shouldAbort: () => aborted,
            sleep: async () => { aborted = true; }, // ...but shutdown is requested while it sleeps
            batchSize: 2,
        });

        // Act
        const result = await backfill.run();

        // Assert
        expect(result).toEqual({ updated: 0, unreadable: 0 });
        expect(repo.getPhotosNeedingIdentity).not.toHaveBeenCalled();
    });

    it('reads files with bounded parallelism, keeping batch results in id order', async () => {
        // Arrange
        const repo = makeRepository(6);
        let running = 0;
        let peak = 0;
        const backfill = new FileIdentityBackfill({
            repository: repo,
            readIdentity: async file => {
                running++; peak = Math.max(peak, running);
                await Promise.resolve();
                running--;
                return identityFor(Number(/p(\d+)/.exec(file)![1]));
            },
            isBusy: () => false,
            sleep: noSleep,
            batchSize: 6,
            readConcurrency: 3,
        });

        // Act
        await backfill.run();

        // Assert
        expect(peak).toBeLessThanOrEqual(3);
        expect(repo.saved[0].map(e => e.id)).toEqual([1, 2, 3, 4, 5, 6]);
    });
});
