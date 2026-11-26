import { describe, it, expect } from 'vitest';
import { CaptionBackfill, type CaptionBackfillDeps, type CaptionCandidate } from '../../../../electron/core/services/CaptionBackfill';

function setup(options: { backlog?: CaptionCandidate[]; busy?: boolean; enabled?: boolean; failing?: number[]; abort?: boolean; batchSize?: number; quietMs?: number } = {}) {
    const backlog = [...(options.backlog ?? [])];
    const captioned: number[] = [];
    const fetches: ReadonlySet<number>[] = [];
    const state = { busy: options.busy ?? false, enabled: options.enabled ?? true, abort: options.abort ?? false, time: 0 };
    const deps: CaptionBackfillDeps = {
        fetchBatch: (skip, limit) => {
            fetches.push(new Set(skip));
            return backlog.filter(photo => !skip.has(photo.id) && !captioned.includes(photo.id)).slice(0, limit);
        },
        caption: async photo => {
            if (options.failing?.includes(photo.id)) return false;
            captioned.push(photo.id);
            return true;
        },
        isBusy: () => state.busy,
        isEnabled: () => state.enabled,
        shouldAbort: () => state.abort,
        now: () => state.time,
    };
    return { backfill: new CaptionBackfill(deps, options.batchSize, options.quietMs ?? 0), captioned, fetches, state };
}

const photos = (...ids: number[]): CaptionCandidate[] => ids.map(id => ({ id, filePath: `R:\\p\\${id}.jpg` }));

describe('CaptionBackfill', () => {
    it('captions one photo per step, newest first as the repository orders them', async () => {
        const { backfill, captioned } = setup({ backlog: photos(30, 20, 10) });

        expect(await backfill.step()).toBe('captioned');
        expect(await backfill.step()).toBe('captioned');

        expect(captioned).toEqual([30, 20]);
    });

    it('reads the backlog in batches, not once per photo', async () => {
        const { backfill, fetches } = setup({ backlog: photos(5, 4, 3, 2, 1) });

        for (let i = 0; i < 5; i++) await backfill.step();

        expect(fetches).toHaveLength(1);
    });

    it('does nothing while a scan or face analysis is running', async () => {
        const { backfill, captioned } = setup({ backlog: photos(1), busy: true });

        expect(await backfill.step()).toBe('busy');

        expect(captioned).toEqual([]);
    });

    it('waits for a stretch of continuous quiet before it starts (the busy flag drops for a moment between two photos of a scan)', async () => {
        const { backfill, captioned, state } = setup({ backlog: photos(2, 1), quietMs: 10_000 });

        expect(await backfill.step()).toBe('busy'); // first quiet moment seen
        state.time = 9_000;
        expect(await backfill.step()).toBe('busy'); // not quiet for long enough yet
        state.time = 10_000;
        expect(await backfill.step()).toBe('captioned');

        expect(captioned).toEqual([2]);
    });

    it('starts the wait again when work shows up in between', async () => {
        const { backfill, state } = setup({ backlog: photos(1), quietMs: 10_000 });
        await backfill.step();
        state.time = 8_000;
        state.busy = true; // a photo of the scan starts
        await backfill.step();
        state.busy = false;
        state.time = 12_000; // 12 s after the first quiet moment, but only 0 s after the interruption
        expect(await backfill.step()).toBe('busy');

        state.time = 22_000;
        expect(await backfill.step()).toBe('captioned');
    });

    it('does nothing when captions are not set to run in the background', async () => {
        const { backfill, captioned } = setup({ backlog: photos(1), enabled: false });

        expect(await backfill.step()).toBe('disabled');

        expect(captioned).toEqual([]);
    });

    it('does nothing once shutdown was asked for', async () => {
        const { backfill, captioned } = setup({ backlog: photos(1), abort: true });

        expect(await backfill.step()).toBe('busy');

        expect(captioned).toEqual([]);
    });

    it('reports done when nothing is left, and looks again later', async () => {
        const { backfill } = setup({ backlog: [] });

        expect(await backfill.step()).toBe('done');
    });

    it('skips a photo that failed for the rest of the session instead of retrying it forever', async () => {
        const { backfill, captioned, fetches } = setup({ backlog: photos(3, 2, 1), failing: [3] });

        expect(await backfill.step()).toBe('failed');
        expect(await backfill.step()).toBe('captioned');

        expect(captioned).toEqual([2]);
        expect(fetches.length).toBe(1); // the batch is reused; the failed photo is simply not offered again
    });

    it('does not offer a failed photo again after the batch is read anew', async () => {
        const { backfill, fetches } = setup({ backlog: photos(3, 2, 1), failing: [3], batchSize: 1 });
        await backfill.step(); // 3 fails
        await backfill.step(); // the batch was used up: read again

        expect(fetches[1].has(3)).toBe(true);
    });

    it('waits much longer after several failures in a row (the engine is probably down)', async () => {
        const { backfill } = setup({ backlog: photos(5, 4, 3, 2, 1), failing: [5, 4, 3, 2, 1] });

        for (let i = 0; i < 5; i++) await backfill.step();

        expect(backfill.delayMsAfter('failed')).toBeGreaterThanOrEqual(5 * 60_000);
    });

    it('goes back to normal pacing after a success', async () => {
        const { backfill } = setup({ backlog: photos(2, 1), failing: [2] });
        await backfill.step(); // fails
        await backfill.step(); // succeeds

        expect(backfill.delayMsAfter('captioned')).toBeLessThan(5000);
        expect(backfill.delayMsAfter('failed')).toBeLessThan(5 * 60_000);
    });

    it('checks the backlog rarely when it is done or disabled, and soon when busy', () => {
        const { backfill } = setup();

        expect(backfill.delayMsAfter('done')).toBeGreaterThanOrEqual(60_000);
        expect(backfill.delayMsAfter('disabled')).toBeGreaterThanOrEqual(30_000);
        expect(backfill.delayMsAfter('busy')).toBeLessThanOrEqual(10_000);
    });
});
