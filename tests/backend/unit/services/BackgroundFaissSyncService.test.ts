import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackgroundFaissSyncService, type FaissSyncDeps } from '../../../../electron/core/services/BackgroundFaissSyncService';

vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const MINUTE = 60_000;

/** Fake collaborators. `named` is the set of named-face ids; the index holds `indexCount` vectors. */
function setup(overrides: Partial<FaissSyncDeps> = {}) {
    const state = { named: [1, 2, 3, 4, 5], indexCount: 0 as number | null, synced: null as string | null, now: 10 * MINUTE, busy: false };
    const rebuildIndex = vi.fn(async () => {
        state.indexCount = state.named.length;
        return true;
    });
    const deps: FaissSyncDeps = {
        getNamedFaceFingerprint: () => ({
            count: state.named.length,
            idSum: state.named.reduce((a, b) => a + b, 0),
            idSquareSum: state.named.reduce((a, b) => a + b * b, 0),
        }),
        getIndexVectorCount: async () => state.indexCount,
        rebuildIndex,
        isBusy: () => state.busy,
        isShutdownRequested: () => false,
        getSyncedFingerprint: () => state.synced,
        setSyncedFingerprint: value => { state.synced = value; },
        now: () => state.now,
        ...overrides,
    };
    return { state, rebuildIndex, service: new BackgroundFaissSyncService(deps) };
}

describe('BackgroundFaissSyncService', () => {
    beforeEach(() => vi.useFakeTimers());

    it('rebuilds an empty index once the named faces have been stable for one check, and remembers the result', async () => {
        const { state, rebuildIndex, service } = setup();

        await service.checkOnce();            // first look: waits
        expect(rebuildIndex).not.toHaveBeenCalled();

        await service.checkOnce();            // unchanged since the last check: rebuilds
        expect(rebuildIndex).toHaveBeenCalledTimes(1);
        expect(state.synced).toBe('5:15:55');

        await service.checkOnce();            // now in sync: nothing more to do
        expect(rebuildIndex).toHaveBeenCalledTimes(1);
    });

    it('does not rebuild while a scan or AI work is running', async () => {
        const { state, rebuildIndex, service } = setup();
        state.busy = true;

        await service.checkOnce();
        await service.checkOnce();

        expect(rebuildIndex).not.toHaveBeenCalled();
    });

    it('waits while faces are still being named, then rebuilds once it is quiet', async () => {
        const { state, rebuildIndex, service } = setup();
        await service.checkOnce();
        state.named.push(6);                  // the user names another face
        await service.checkOnce();
        expect(rebuildIndex).not.toHaveBeenCalled();

        await service.checkOnce();            // quiet now
        expect(rebuildIndex).toHaveBeenCalledTimes(1);
    });

    it('picks up faces removed from people later (index larger than the named set)', async () => {
        const { state, rebuildIndex, service } = setup();
        await service.checkOnce();
        await service.checkOnce();            // initial rebuild
        rebuildIndex.mockClear();

        state.named.pop();                    // a face was unassigned; the index still has it
        await service.checkOnce();            // sees the change
        await service.checkOnce();            // stable
        expect(rebuildIndex).toHaveBeenCalledTimes(1);
        expect(state.indexCount).toBe(4);
    });

    it('records the state without rebuilding when the index already matches and nothing was recorded (upgrade)', async () => {
        const { state, rebuildIndex, service } = setup();
        state.indexCount = 5;

        await service.checkOnce();
        await service.checkOnce();

        expect(rebuildIndex).not.toHaveBeenCalled();
        expect(state.synced).toBe('5:15:55');
    });

    it('does nothing for a library with no named faces and an empty index', async () => {
        const { state, rebuildIndex, service } = setup();
        state.named = [];

        await service.checkOnce();
        await service.checkOnce();

        expect(rebuildIndex).not.toHaveBeenCalled();
    });

    it('retries a failed rebuild only after a pause, not at every check', async () => {
        const { state, rebuildIndex, service } = setup();
        rebuildIndex.mockResolvedValue(false);
        await service.checkOnce();
        await service.checkOnce();            // fails
        expect(rebuildIndex).toHaveBeenCalledTimes(1);

        state.now += MINUTE;
        await service.checkOnce();            // too soon
        expect(rebuildIndex).toHaveBeenCalledTimes(1);

        state.now += 10 * MINUTE;
        await service.checkOnce();            // after the pause
        expect(rebuildIndex).toHaveBeenCalledTimes(2);
    });

    it('treats a rebuild that throws like a failure', async () => {
        const { rebuildIndex, service } = setup();
        rebuildIndex.mockRejectedValue(new Error('backend died'));
        await service.checkOnce();

        await expect(service.checkOnce()).resolves.toBeUndefined();
        expect(rebuildIndex).toHaveBeenCalledTimes(1);
    });

    it('waits when the AI backend does not answer', async () => {
        const { state, rebuildIndex, service } = setup();
        state.indexCount = null;

        await service.checkOnce();
        await service.checkOnce();

        expect(rebuildIndex).not.toHaveBeenCalled();
    });

    it('does not check before its startup delay and stops cleanly', async () => {
        const { rebuildIndex, service } = setup();
        service.start();

        await vi.advanceTimersByTimeAsync(30_000);   // inside the startup delay
        expect(rebuildIndex).not.toHaveBeenCalled();

        await service.stop();
        await vi.advanceTimersByTimeAsync(10 * MINUTE);
        expect(rebuildIndex).not.toHaveBeenCalled();
    });
});
