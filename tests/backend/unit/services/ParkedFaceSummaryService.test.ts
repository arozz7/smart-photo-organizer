import { describe, it, expect, vi } from 'vitest';
import {
    ParkedFaceSummaryService,
    type NeighbourCountsRequest,
    type NeighbourCountsResponse,
    type ParkedFaceSummaryDeps,
    type UnassignedFace,
} from '../../../../electron/core/services/ParkedFaceSummaryService';
import { DEFAULT_PARKED_SETTINGS } from '../../../../electron/core/services/parkedFaces';

vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const DIM = 512;
const descriptor = () => Buffer.alloc(DIM * 4);
const BOX_BIG = '{"x":0,"y":0,"width":200,"height":200}';
const BOX_TINY = '{"x":0,"y":0,"width":20,"height":20}';

interface Spec {
    id: number;
    box?: string;
    blur?: number;
    twins?: number;
    twinsAlt?: number;
    sameShot?: number;
    photo?: number;
    taken?: string;
    nearest?: number;
    descriptor?: Buffer;
}

/** A fake library: each face carries the answer the AI backend should give for it. */
function setup(specs: Spec[], overrides: Partial<ParkedFaceSummaryDeps> = {}) {
    const state = {
        specs,
        busy: false,
        cache: null as string | null,
        centroids: [[0.1, 0.2]] as number[][],
        requests: [] as NeighbourCountsRequest[],
        removedFiles: 0,
        shotIds: [] as number[],
        failWith: null as 'null' | 'throw' | 'short' | null,
        becomeBusyAfterRequests: Infinity,
    };
    const loadFaces = vi.fn((): UnassignedFace[] =>
        state.specs.map(s => ({
            id: s.id,
            descriptor: s.descriptor ?? descriptor(),
            boxJson: s.box ?? BOX_BIG,
            blur: s.blur ?? 300,
            photoId: s.photo ?? s.id,
            filePath: `D:\\Photos\\${s.photo ?? s.id}.jpg`,
            dateTaken: s.taken ?? null,
        }))
    );
    const requestNeighbourCounts = vi.fn(async (request: NeighbourCountsRequest): Promise<NeighbourCountsResponse | null> => {
        state.requests.push(request);
        if (state.requests.length >= state.becomeBusyAfterRequests) state.busy = true;
        if (state.failWith === 'null') return null;
        if (state.failWith === 'throw') throw new Error('backend down');
        // Rows are the faces that were written to the file, in order: those with a descriptor of the right size.
        const rows = state.specs.filter(s => (s.descriptor ?? descriptor()).byteLength === DIM * 4);
        const slice = rows.slice(request.rowStart, request.rowEnd);
        const length = state.failWith === 'short' ? slice.length - 1 : slice.length;
        return {
            counts: [slice.slice(0, length).map(s => s.twins ?? 1), slice.slice(0, length).map(s => s.twinsAlt ?? s.twins ?? 1)],
            excluded: slice.slice(0, length).map(s => s.sameShot ?? 0),
            nearestCentroid: request.centroids.length === 0 ? null : slice.slice(0, length).map(s => s.nearest ?? 5),
            total: rows.length,
        };
    });
    const deps: ParkedFaceSummaryDeps = {
        getFingerprint: () => ({
            count: state.specs.length,
            idSum: state.specs.reduce((a, s) => a + s.id, 0),
            idSquareSum: state.specs.reduce((a, s) => a + s.id * s.id, 0),
        }),
        loadFaces,
        getCentroids: () => state.centroids,
        withDataFiles: async (_buffers, shotIds, use) => {
            state.shotIds = shotIds;
            try {
                return await use({ descriptorsPath: '/tmp/descriptors.f32', shotsPath: '/tmp/shots.i32' });
            } finally {
                state.removedFiles++;
            }
        },
        requestNeighbourCounts,
        isBusy: () => state.busy,
        readCache: () => state.cache,
        writeCache: value => { state.cache = value; },
        now: () => Date.parse('2026-11-18T12:00:00Z'),
        ...overrides,
    };
    return { state, loadFaces, requestNeighbourCounts, service: new ParkedFaceSummaryService(deps, DEFAULT_PARKED_SETTINGS, 2) };
}

describe('ParkedFaceSummaryService', () => {
    it('counts parked and reviewable faces across several requests to the AI backend', async () => {
        const { service, requestNeighbourCounts } = setup([
            { id: 1 },                              // clear, has a twin: review
            { id: 2, twins: 0 },                    // alone: parked
            { id: 3, box: BOX_TINY },               // too small: parked
            { id: 4, twins: 0, nearest: 0.5 },      // alone but near a named person: review
            { id: 5, blur: 10 },                    // too blurry: parked
        ]);

        const result = await service.getSummary();

        expect(requestNeighbourCounts).toHaveBeenCalledTimes(3);   // 5 faces, 2 per request
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.summary).toMatchObject({ unassigned: 5, lowQuality: 2, singleton: 1, nearNamed: 1, parked: 3, worthReviewing: 2 });
        expect(result.fromCache).toBe(false);
        expect(result.computedAt).toBe('2026-11-18T12:00:00.000Z');
    });

    it('asks for twins at both distances, with the copy distance and the named centroids', async () => {
        const { service, state } = setup([{ id: 1 }, { id: 2 }]);

        await service.getSummary();

        expect(state.requests[0]).toMatchObject({
            dim: DIM,
            rowStart: 0,
            rowEnd: 2,
            distances: [DEFAULT_PARKED_SETTINGS.twinDistance, DEFAULT_PARKED_SETTINGS.alternativeTwinDistance],
            duplicateDistance: DEFAULT_PARKED_SETTINGS.duplicateDistance,
            centroids: [[0.1, 0.2]],
        });
    });

    it('works before anyone is named (no centroids)', async () => {
        const { service, state } = setup([{ id: 1, twins: 0 }]);
        state.centroids = [];

        const result = await service.getSummary();

        expect(result.status === 'ready' && result.summary.singleton).toBe(1);
    });

    it('answers from the saved result when nothing has changed, without touching the faces or the backend', async () => {
        const { service, loadFaces, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
        await service.getSummary();
        loadFaces.mockClear();
        requestNeighbourCounts.mockClear();

        const again = await service.getSummary();

        expect(again.status === 'ready' && again.fromCache).toBe(true);
        expect(loadFaces).not.toHaveBeenCalled();
        expect(requestNeighbourCounts).not.toHaveBeenCalled();
    });

    it('answers from the saved result in a new session (the cache is stored, not just kept in memory)', async () => {
        const first = setup([{ id: 1 }, { id: 2 }]);
        await first.service.getSummary();
        const second = setup([{ id: 1 }, { id: 2 }]);
        second.state.cache = first.state.cache;

        const result = await second.service.getSummary();

        expect(result.status === 'ready' && result.fromCache).toBe(true);
        expect(second.requestNeighbourCounts).not.toHaveBeenCalled();
    });

    describe('saved result only (opening the page must not start a measurement)', () => {
        it('returns the saved result when it is still current', async () => {
            const { service, loadFaces, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
            await service.getSummary();
            loadFaces.mockClear();
            requestNeighbourCounts.mockClear();

            const result = await service.getSummary({ cachedOnly: true });

            expect(result.status === 'ready' && result.fromCache).toBe(true);
            expect(loadFaces).not.toHaveBeenCalled();
            expect(requestNeighbourCounts).not.toHaveBeenCalled();
        });

        it('says the result is out of date, and offers the last one, when faces or people changed', async () => {
            const { service, state, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
            await service.getSummary();
            state.specs = [{ id: 1 }, { id: 2 }, { id: 3 }];
            requestNeighbourCounts.mockClear();

            const result = await service.getSummary({ cachedOnly: true });

            expect(result.status).toBe('stale');
            expect(result.status === 'stale' && result.summary?.unassigned).toBe(2);
            expect(requestNeighbourCounts).not.toHaveBeenCalled();
        });

        it('says there is nothing yet when no measurement was ever saved', async () => {
            const { service, loadFaces } = setup([{ id: 1 }]);

            expect(await service.getSummary({ cachedOnly: true })).toEqual({ status: 'stale', summary: null });
            expect(loadFaces).not.toHaveBeenCalled();
        });

        it('answers at once even while a measurement is running', async () => {
            let release: () => void = () => undefined;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const { service, state } = setup([{ id: 1 }], {
                requestNeighbourCounts: async request => {
                    await gate;
                    return { counts: [[1], [1]], excluded: [0], nearestCentroid: request.centroids.length ? [5] : null, total: 1 };
                },
            });
            const running = service.getSummary();

            const quick = await service.getSummary({ cachedOnly: true });
            release();
            await running;

            expect(quick.status).toBe('stale');
            expect(state.cache).not.toBeNull();
        });
    });

    it('recomputes when asked to refresh', async () => {
        const { service, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
        await service.getSummary();
        requestNeighbourCounts.mockClear();

        const result = await service.getSummary({ refresh: true });

        expect(requestNeighbourCounts).toHaveBeenCalled();
        expect(result.status === 'ready' && result.fromCache).toBe(false);
    });

    it('recomputes when the set of unassigned faces changes', async () => {
        const { service, state, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
        await service.getSummary();
        requestNeighbourCounts.mockClear();
        state.specs = [{ id: 1 }, { id: 3 }];     // same count, different face

        await service.getSummary();

        expect(requestNeighbourCounts).toHaveBeenCalled();
    });

    it('recomputes when the named people change', async () => {
        const { service, state, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
        await service.getSummary();
        requestNeighbourCounts.mockClear();
        state.centroids = [[0.1, 0.2], [0.3, 0.4]];

        await service.getSummary();

        expect(requestNeighbourCounts).toHaveBeenCalled();
    });

    it('ignores a saved result that cannot be read', async () => {
        const { service, state } = setup([{ id: 1 }]);
        state.cache = '{not json';

        const result = await service.getSummary();

        expect(result.status).toBe('ready');
    });

    it('does not start while a scan or AI work is running, and offers the last saved result', async () => {
        const { service, state, requestNeighbourCounts } = setup([{ id: 1 }, { id: 2 }]);
        await service.getSummary();
        state.specs = [{ id: 1 }, { id: 2 }, { id: 3 }];
        state.busy = true;
        requestNeighbourCounts.mockClear();

        const result = await service.getSummary();

        expect(result.status).toBe('busy');
        expect(result.status === 'busy' && result.summary?.unassigned).toBe(2);
        expect(requestNeighbourCounts).not.toHaveBeenCalled();
    });

    it('reports busy with no result when nothing was ever computed', async () => {
        const { service, state } = setup([{ id: 1 }]);
        state.busy = true;

        expect(await service.getSummary()).toEqual({ status: 'busy', summary: null });
    });

    it('stops between requests when other work starts, and keeps the previous saved result', async () => {
        const { service, state } = setup([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
        await service.getSummary();
        const saved = state.cache;
        state.specs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }];
        state.requests = [];
        state.becomeBusyAfterRequests = 1;

        const result = await service.getSummary();

        expect(result.status).toBe('busy');
        expect(state.requests).toHaveLength(1);
        expect(state.cache).toBe(saved);
    });

    it.each(['null', 'throw', 'short'] as const)('fails cleanly, without saving anything, when the AI backend misbehaves (%s)', async failure => {
        const { service, state } = setup([{ id: 1 }, { id: 2 }, { id: 3 }]);
        state.failWith = failure;

        const result = await service.getSummary();

        expect(result.status).toBe('failed');
        expect(state.cache).toBeNull();
        expect(state.removedFiles).toBe(1);        // the temporary descriptor file is removed even on failure
    });

    it('can compute again after a failure', async () => {
        const { service, state } = setup([{ id: 1 }]);
        state.failWith = 'null';
        await service.getSummary();
        state.failWith = null;

        expect((await service.getSummary()).status).toBe('ready');
    });

    it('shares one computation between simultaneous callers', async () => {
        const { service, loadFaces } = setup([{ id: 1 }, { id: 2 }]);

        const [a, b] = await Promise.all([service.getSummary(), service.getSummary()]);

        expect(loadFaces).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
    });

    it('skips faces whose descriptor has an unexpected size, rather than corrupting the file', async () => {
        const { service, state } = setup([{ id: 1 }, { id: 2, descriptor: Buffer.alloc(10) }, { id: 3 }]);

        const result = await service.getSummary();

        expect(result.status === 'ready' && result.summary.unassigned).toBe(2);
        expect(state.requests[0].rowEnd).toBe(2);
    });

    it('labels faces of one photo or one capture second as one shot, and passes the labels to the AI backend', async () => {
        const { service, state } = setup([
            { id: 1, photo: 10 },
            { id: 2, photo: 10 },                       // same photo as 1
            { id: 3, photo: 11, taken: '2024-05-01T10:00:00' },
            { id: 4, photo: 12, taken: '2024-05-01T10:00:00' },   // same second as 3
            { id: 5, photo: 13 },
        ]);

        await service.getSummary();

        const [a, b, c, d, e] = state.shotIds;
        expect(a).toBe(b);
        expect(c).toBe(d);
        expect(new Set([a, c, e]).size).toBe(3);
        expect(state.requests[0].shotsPath).toBe('/tmp/shots.i32');
        expect(state.requests[0].dataPath).toBe('/tmp/descriptors.f32');
    });

    it('reports an empty library without asking the backend', async () => {
        const { service, requestNeighbourCounts } = setup([]);

        const result = await service.getSummary();

        expect(result.status === 'ready' && result.summary).toMatchObject({ unassigned: 0, parked: 0, worthReviewing: 0 });
        expect(requestNeighbourCounts).not.toHaveBeenCalled();
    });
});
