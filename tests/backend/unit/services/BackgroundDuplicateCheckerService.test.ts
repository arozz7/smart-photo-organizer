import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Created before the (hoisted) vi.mock calls below run.
const { flags, photoRepo } = vi.hoisted(() => ({
    // In-memory stand-in for the app_state flags the service reads and writes.
    flags: new Map<string, string>(),
    photoRepo: {
        getPhotosNeedingSha256: vi.fn(() => [] as { id: number; file_path: string }[]),
        getPhotosNeedingPhash: vi.fn(() => [] as { id: number; file_path: string; preview_cache_path: string | null }[]),
        updatePhotoPhash: vi.fn(),
        updatePhotoSha256: vi.fn(),
        recordScanError: vi.fn(),
        findExactDuplicateGroups: vi.fn(() => []),
        getPhotosWithPhash: vi.fn(() => [{ id: 1, phash: 'a'.repeat(16) }, { id: 2, phash: 'b'.repeat(16) }]),
        getPhotoById: vi.fn(() => ({ duplicate_group_id: null })),
        setDuplicateGroup: vi.fn(),
    },
}));

vi.mock('../../../../electron/data/repositories/AppStateRepository', () => ({
    AppStateRepository: {
        isShutdownRequested: () => false,
        isScanActive: () => false,
        isAIProcessingActive: () => false,
        isDuplicateCheckDirty: () => flags.get('duplicate_check_dirty') === '1',
        markDuplicateCheckDirty: () => { flags.set('duplicate_check_dirty', '1'); },
        clearDuplicateCheckDirty: () => { flags.set('duplicate_check_dirty', '0'); },
        hasCompletedDuplicateCheck: () => flags.get('duplicate_check_completed_v2') === '1',
        markDuplicateCheckCompleted: () => { flags.set('duplicate_check_completed_v2', '1'); },
    },
}));

vi.mock('../../../../electron/data/repositories/PhotoRepository', () => ({ PhotoRepository: photoRepo }));
vi.mock('../../../../electron/data/repositories/DuplicateGroupRepository', () => ({
    DuplicateGroupRepository: { findExistingGroup: () => null, createGroup: () => 1 },
}));
vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { BackgroundDuplicateCheckerService } from '../../../../electron/core/services/BackgroundDuplicateCheckerService';

const MINUTE = 60_000;
const STARTUP_DELAY = 30_000;

const nearPassCalls = (sendRequest: ReturnType<typeof vi.fn>) =>
    sendRequest.mock.calls.filter(call => call[0] === 'group_near_duplicates');

async function runFor(service: BackgroundDuplicateCheckerService, ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
}

describe('BackgroundDuplicateCheckerService', () => {
    let sendRequest: ReturnType<typeof vi.fn>;
    let service: BackgroundDuplicateCheckerService;

    beforeEach(() => {
        vi.useFakeTimers();
        flags.clear();
        Object.values(photoRepo).forEach(fn => fn.mockClear());
        photoRepo.getPhotosNeedingSha256.mockReturnValue([]);
        photoRepo.getPhotosNeedingPhash.mockReturnValue([]);
        sendRequest = vi.fn(async (command: string) => (command === 'group_near_duplicates' ? { groups: [] } : { results: [] }));
        service = new BackgroundDuplicateCheckerService({ sendRequest } as never);
    });

    afterEach(async () => {
        const stopping = service.stop();
        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        await stopping;
        vi.useRealTimers();
    });

    it('does not repeat the duplicate check at launch once a full check has completed', async () => {
        flags.set('duplicate_check_completed_v2', '1');
        service.start();

        await runFor(service, STARTUP_DELAY + 10 * MINUTE);

        expect(nearPassCalls(sendRequest)).toHaveLength(0);
    });

    it('runs one full check when none has ever completed, then marks it done and does not repeat it', async () => {
        service.start();

        await runFor(service, STARTUP_DELAY + 10 * MINUTE);

        expect(nearPassCalls(sendRequest)).toHaveLength(1);
        expect(flags.get('duplicate_check_completed_v2')).toBe('1');
        expect(flags.get('duplicate_check_dirty')).toBe('0');
    });

    it('gives the near-duplicate request five minutes instead of one', async () => {
        service.start();

        await runFor(service, STARTUP_DELAY + MINUTE);

        expect(nearPassCalls(sendRequest)[0][2]).toBe(300_000);
    });

    it('checks again after new hashes were computed', async () => {
        flags.set('duplicate_check_completed_v2', '1');
        photoRepo.getPhotosNeedingPhash
            .mockReturnValueOnce([{ id: 7, file_path: 'R:\new.jpg', preview_cache_path: null }])
            .mockReturnValue([]);
        sendRequest.mockImplementation(async (command: string) => {
            if (command === 'compute_phash_batch') return { results: [{ id: 7, phash: 'c'.repeat(16) }] };
            return { groups: [] };
        });
        service.start();

        await runFor(service, STARTUP_DELAY + 5 * MINUTE);

        expect(photoRepo.updatePhotoPhash).toHaveBeenCalledWith(7, 'c'.repeat(16));
        expect(nearPassCalls(sendRequest)).toHaveLength(1);
    });

    it('does not count a failed near pass as complete, and retries it only after a long pause', async () => {
        sendRequest.mockImplementation(async (command: string) => {
            if (command === 'group_near_duplicates') throw new Error('Timeout');
            return { results: [] };
        });
        service.start();

        await runFor(service, STARTUP_DELAY + 10 * MINUTE);

        expect(nearPassCalls(sendRequest)).toHaveLength(1);
        expect(flags.get('duplicate_check_completed_v2')).toBeUndefined();
        expect(flags.get('duplicate_check_dirty')).toBe('1');

        await runFor(service, 30 * MINUTE);

        expect(nearPassCalls(sendRequest).length).toBeGreaterThanOrEqual(2);
    });
});
