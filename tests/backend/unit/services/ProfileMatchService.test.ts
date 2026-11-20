import { describe, it, expect, vi } from 'vitest';
import {
    ProfileMatchService,
    COMPUTE_STEP,
    DEFAULT_DISTANCE,
    type ProfileMatchDeps,
} from '../../../../electron/core/services/ProfileMatchService';

vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** A descriptor whose direction is `angle` on a circle in the first two dimensions, scaled to length 20 like the library's. */
const descriptor = (angle: number): Buffer => {
    const values = new Float32Array(512);
    values[0] = 20 * Math.cos(angle);
    values[1] = 20 * Math.sin(angle);
    return Buffer.from(values.buffer);
};
const angleOf = (distance: number) => 2 * Math.asin(distance / 2);

interface Example { faceId: number; personId: number; photoId: number; angle: number }
interface Cand { id: number; photoId: number; angle: number }

interface World {
    examples: Example[];
    candidates: Cand[];
    inPhoto?: Map<number, Set<number>>;
    dismissed?: Set<string>;
    fingerprint?: string;
}

function build(world: World) {
    const state = {
        flags: new Map<string, string>(),
        fingerprint: world.fingerprint ?? 'fp1',
        assigned: [] as { faceId: number; personId: number; distance: number }[],
        dismissedLog: [] as { faceId: number; personId: number }[],
        recalculated: [] as number[],
        yields: 0,
        stepsRequested: [] as number[],
    };
    const deps: ProfileMatchDeps = {
        loadExamples: () => world.examples.map(e => ({ faceId: e.faceId, personId: e.personId, photoId: e.photoId, descriptor: descriptor(e.angle) })),
        countCandidates: () => world.candidates.length,
        loadCandidates: (afterId, limit) => {
            state.stepsRequested.push(limit);
            return world.candidates.filter(c => c.id > afterId).slice(0, limit).map(c => ({ id: c.id, photoId: c.photoId, descriptor: descriptor(c.angle) }));
        },
        personsInPhotos: photoIds => new Map(photoIds.filter(id => world.inPhoto?.has(id)).map(id => [id, world.inPhoto!.get(id)!])),
        dismissedPairs: () => new Set(world.dismissed ?? []),
        assign: items => { state.assigned.push(...items); return items.map(({ faceId, personId }) => ({ faceId, personId })); },
        dismiss: items => { state.dismissedLog.push(...items.map(({ faceId, personId }) => ({ faceId, personId }))); },
        undo: faceIds => faceIds.map(faceId => ({ faceId, personId: 10 })),
        countAssigned: () => state.assigned.length,
        faceTiles: ids => ids.map(faceId => ({ faceId, photoId: 1, box: { x: 1, y: 1, width: 2, height: 2 }, yaw: 60, quality: 0.5, blur: 100, filePath: 'f', previewPath: 'p', photoWidth: 10, photoHeight: 10 })),
        personNames: ids => new Map(ids.map(id => [id, `Person ${id}`])),
        frontalReference: personId => 9000 + personId,
        recalculate: async personId => { state.recalculated.push(personId); },
        fingerprint: () => state.fingerprint,
        readFlag: key => state.flags.get(key) ?? null,
        writeFlag: (key, value) => { state.flags.set(key, value); },
        yieldToEventLoop: async () => { state.yields++; },
        now: () => '2026-11-19T10:00:00Z',
    };
    return { service: new ProfileMatchService(deps), state, deps };
}

/** Candidate at angle `base`; an example at base + angleOf(d) is exactly d away. */
const BASE = angleOf(0.9);
const exampleAt = (faceId: number, personId: number, photoId: number, distance: number, side = 1): Example => ({ faceId, personId, photoId, angle: BASE + side * angleOf(distance) });
const candidate = (id: number, photoId: number): Cand => ({ id, photoId, angle: BASE });

const ready = async (world: World) => {
    const built = build(world);
    built.service.getOverview();
    await built.service.whenReady();
    return built;
};

describe('ProfileMatchService', () => {
    describe('overview and settings', () => {
        it('starts the search when asked and reports progress, then the counts', async () => {
            const { service } = build({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1), candidate(101, 3)] });

            expect(service.getOverview().state).toBe('computing');
            await service.whenReady();
            const overview = service.getOverview();

            expect(overview).toMatchObject({ state: 'ready', total: 2, twoNames: 0, examples: 1, peopleWithExamples: 1, checked: 2, candidates: 2, stale: false });
            expect(overview.byPerson).toEqual([{ personId: 10, name: 'Person 10', count: 2 }]);
        });

        it('uses 1.0 and 40 degrees until the user changes them, and keeps the settings in range', async () => {
            const { service } = await ready({ examples: [], candidates: [] });

            expect(service.getOverview().settings).toMatchObject({ distance: DEFAULT_DISTANCE, minYaw: 40 });
            expect(service.setDistance(0.79)).toBe(false);
            expect(service.setDistance(1.11)).toBe(false);
            expect(service.setDistance(Number.NaN)).toBe(false);
            expect(service.setMinYaw(39)).toBe(false);
            expect(service.setMinYaw(71)).toBe(false);
            expect(service.setDistance(0.9)).toBe(true);
            expect(service.setMinYaw(50)).toBe(true);
            expect(service.getOverview().settings).toMatchObject({ distance: 0.9, minYaw: 50 });
        });

        it('searches again under a new distance and shows fewer faces at a smaller one', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.95)], candidates: [candidate(100, 1)] });
            expect(service.getOverview().total).toBe(1);

            service.setDistance(0.9);
            service.getOverview();
            await service.whenReady();

            expect(service.getOverview().total).toBe(0);
        });

        it('searches again when the named faces changed (a confirmation on the person page, an ignore)', async () => {
            const { service, state } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1)] });
            state.fingerprint = 'fp2';

            expect(service.getOverview().state).toBe('computing');
            await service.whenReady();

            expect(service.getOverview().state).toBe('ready');
        });

        it('works in steps with a pause between them, so the window stays responsive', async () => {
            const candidates = Array.from({ length: COMPUTE_STEP * 2 + 5 }, (_, i) => candidate(100 + i, 1000 + i));
            const { service, state } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates });

            expect(state.stepsRequested.every(limit => limit === COMPUTE_STEP)).toBe(true);
            expect(state.yields).toBeGreaterThanOrEqual(3);
            expect(service.getOverview().total).toBe(candidates.length);
        });

        it('reports an error instead of throwing when the search fails', async () => {
            const { service, deps } = build({ examples: [], candidates: [] });
            deps.loadExamples = () => { throw new Error('disk gone'); };

            service.getOverview();
            await service.whenReady();

            expect(service.getOverview()).toMatchObject({ state: 'error', error: 'disk gone' });
        });

        it('drops a search that a setting change made out of date', async () => {
            const candidates = Array.from({ length: COMPUTE_STEP + 1 }, (_, i) => candidate(100 + i, 1000 + i));
            const { service, deps } = build({ examples: [exampleAt(1, 10, 2, 0.95)], candidates });
            let release: () => void = () => undefined;
            const gate = new Promise<void>(resolve => { release = resolve; });
            let first = true;
            deps.yieldToEventLoop = async () => { if (first) { first = false; await gate; } };

            service.getOverview();
            service.setDistance(0.9);
            service.getOverview();
            release();
            await service.whenReady();

            expect(service.getOverview()).toMatchObject({ state: 'ready', total: 0 });
        });
    });

    describe('what is suggested', () => {
        it('shows both names, nearest first, when two people are within the distance', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7), exampleAt(2, 11, 3, 0.95, -1)], candidates: [candidate(100, 1)] });

            const [row] = service.list(0, 10);

            expect(service.getOverview().twoNames).toBe(1);
            expect(row.person).toMatchObject({ personId: 10, name: 'Person 10' });
            expect(row.person.distance).toBeCloseTo(0.7, 2);
            expect(row.also).toMatchObject({ personId: 11, name: 'Person 11' });
        });

        it('leaves out a person who already has a face in the photo, and a pair the user dismissed', async () => {
            const { service } = await ready({
                examples: [exampleAt(1, 10, 2, 0.7), exampleAt(2, 11, 3, 0.8, -1)],
                candidates: [candidate(100, 1)],
                inPhoto: new Map([[1, new Set([10])]]),
                dismissed: new Set(['100:11']),
            });

            expect(service.list(0, 10)).toEqual([]);
        });

        it('gives a person to only the nearest face of a photo', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 5), { id: 101, photoId: 5, angle: BASE + 0.001 }] });

            expect(service.list(0, 10).map(row => row.faceId)).toHaveLength(1);
        });

        it('lists the people with the most suggestions first, with the examples and a frontal face of the person to show', async () => {
            const far = BASE + Math.PI;
            const { service } = await ready({
                examples: [exampleAt(1, 10, 2, 0.5), exampleAt(2, 10, 3, 0.6), { faceId: 3, personId: 11, photoId: 4, angle: far + angleOf(0.4) }],
                candidates: [candidate(100, 1), candidate(101, 6), { id: 102, photoId: 7, angle: far }],
            });

            const rows = service.list(0, 10);

            expect(rows.map(row => row.person.personId)).toEqual([10, 10, 11]);
            expect(rows[0].examples.map(tile => tile.faceId)).toEqual([1, 2]);
            expect(rows[0].frontal?.faceId).toBe(9010);
            expect(rows[0].tile.faceId).toBe(rows[0].faceId);
            expect(service.getOverview().byPerson.map(item => [item.personId, item.count])).toEqual([[10, 2], [11, 1]]);
        });

        it('pages the list', async () => {
            const candidates = Array.from({ length: 5 }, (_, i) => candidate(100 + i, 1000 + i));
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates });

            expect(service.list(0, 2)).toHaveLength(2);
            expect(service.list(4, 2)).toHaveLength(1);
        });

        it('can be limited to one person (the button on the person page)', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1)] });

            expect(service.list(0, 10, 10)).toHaveLength(1);
            expect(service.list(0, 10, 11)).toHaveLength(0);
        });
    });

    describe('assign', () => {
        const world = (): World => ({ examples: [exampleAt(1, 10, 2, 0.7), exampleAt(2, 11, 3, 0.8, -1)], candidates: [candidate(100, 1), candidate(101, 1)] });

        it('gives the face to the person with the distance it was suggested at, and rebuilds that person\'s centroids', async () => {
            const { service, state } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1)] });

            const result = await service.assign([{ faceId: 100, personId: 10 }]);

            expect(result).toEqual({ assigned: [{ faceId: 100, personId: 10 }], skipped: 0 });
            expect(state.assigned).toHaveLength(1);
            expect(state.assigned[0].distance).toBeCloseTo(0.7, 2);
            expect(state.recalculated).toEqual([10]);
        });

        it('lets the user pick the second name of a two-name face', async () => {
            const { service, state } = await ready(world());

            await service.assign([{ faceId: 100, personId: 11 }]);

            expect(state.assigned.map(item => item.personId)).toEqual([11]);
        });

        it('refuses a person the face was not suggested for, so the renderer cannot choose anyone', async () => {
            const { service, state } = await ready(world());

            const result = await service.assign([{ faceId: 100, personId: 99 }, { faceId: 12345, personId: 10 }]);

            expect(result).toEqual({ assigned: [], skipped: 2 });
            expect(state.assigned).toEqual([]);
            expect(state.recalculated).toEqual([]);
        });

        it('takes the assigned faces out of the list and marks the results as possibly out of date', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1), candidate(101, 7)] });

            await service.assign([{ faceId: 100, personId: 10 }]);

            expect(service.list(0, 10).map(row => row.faceId)).toEqual([101]);
            expect(service.getOverview()).toMatchObject({ total: 1, stale: true, state: 'ready' });
        });

        it('rebuilds each person once, however many faces they got', async () => {
            const { service, state } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1), candidate(101, 7), candidate(102, 8)] });

            await service.assign([{ faceId: 100, personId: 10 }, { faceId: 101, personId: 10 }, { faceId: 102, personId: 10 }]);

            expect(state.recalculated).toEqual([10]);
        });
    });

    describe('dismiss', () => {
        it('remembers "not this person" and shows the face under its other name', async () => {
            const { service, state } = await ready({ examples: [exampleAt(1, 10, 2, 0.7), exampleAt(2, 11, 3, 0.8, -1)], candidates: [candidate(100, 1)] });

            await service.dismiss([{ faceId: 100, personId: 10 }]);

            expect(state.dismissedLog).toEqual([{ faceId: 100, personId: 10 }]);
            const [row] = service.list(0, 10);
            expect(row.person.personId).toBe(11);
            expect(row.also).toBeNull();
        });

        it('takes a face with no name left out of the list', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1)] });

            await service.dismiss([{ faceId: 100, personId: 10 }]);

            expect(service.list(0, 10)).toEqual([]);
            expect(service.getOverview().total).toBe(0);
        });
    });

    describe('undo', () => {
        it('returns the faces, rebuilds the people they came back from, and searches again', async () => {
            const { service, state } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1)] });
            await service.assign([{ faceId: 100, personId: 10 }]);
            state.recalculated.length = 0;

            const result = await service.undo([100]);

            expect(result.restored).toEqual([{ faceId: 100, personId: 10 }]);
            expect(state.recalculated).toEqual([10]);
            expect(service.getOverview().state).toBe('computing');
        });
    });

    describe('refresh', () => {
        it('searches again (new faces from a scan)', async () => {
            const { service } = await ready({ examples: [exampleAt(1, 10, 2, 0.7)], candidates: [candidate(100, 1)] });

            service.refresh();

            expect(service.getOverview().state).toBe('computing');
            await service.whenReady();
            expect(service.getOverview().stale).toBe(false);
        });
    });
});
