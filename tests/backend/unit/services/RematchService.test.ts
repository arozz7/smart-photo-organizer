import { describe, it, expect, vi } from 'vitest';
import {
    RematchService,
    type RematchDeps,
    type RematchFace,
    type RematchMatch,
} from '../../../../electron/core/services/RematchService';

vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const DIM = 512;
const MINUTE = 60_000;

/** A descriptor whose first number is the face id, so the fake matcher can tell faces apart. */
function descriptorFor(id: number): Buffer {
    const values = new Float32Array(DIM);
    values[0] = id;
    return Buffer.from(values.buffer);
}

interface Setup {
    faces: number[];
    /** What the matcher answers for a face, when the threshold allows it. */
    answers: Record<number, { personId: number; distance: number }>;
    tried: string[];
    people: object[];
}

function setup(partial: Partial<Setup> = {}, overrides: Partial<RematchDeps> = {}, options: { batchSize?: number; minIntervalMs?: number } = {}) {
    const world = {
        faces: partial.faces ?? [1, 2, 3, 4, 5],
        answers: partial.answers ?? ({} as Setup['answers']),
        tried: new Set(partial.tried ?? []),
        people: partial.people ?? [{ id: 7 }],
        busy: false,
        /** The scan Auto-Assign distance setting (Settings > AI Performance). */
        autoAssign: 0.65,
        fingerprint: 'people-v1',
        flags: new Map<string, string>(),
        saved: [] as RematchMatch[],
        now: Date.parse('2026-11-18T10:00:00Z'),
        undone: 0,
        undoable: 0,
        matcherThresholds: [] as number[],
        failMatching: false,
        pageRequests: [] as { afterId: number; limit: number }[],
    };
    const deps: RematchDeps = {
        loadPeople: () => world.people,
        centroidFingerprint: () => world.fingerprint,
        match: (descriptor, _people, threshold) => {
            if (world.failMatching) throw new Error('matcher broke');
            world.matcherThresholds.push(threshold);
            const answer = world.answers[descriptor[0]];
            return answer && answer.distance <= threshold ? answer : null;
        },
        countUnassigned: () => world.faces.length,
        loadFaces: (afterId, limit): RematchFace[] => {
            world.pageRequests.push({ afterId, limit });
            return world.faces
                .filter(id => id > afterId)
                .sort((a, b) => a - b)
                .slice(0, limit)
                .map(id => ({ id, descriptor: descriptorFor(id) }));
        },
        findTriedPairs: ids => new Set([...world.tried].filter(pair => ids.includes(Number(pair.split(':')[0])))),
        saveMatches: matches => {
            world.saved.push(...matches);
            // an assigned face leaves the unassigned set, like in the database
            world.faces = world.faces.filter(id => !matches.some(m => m.faceId === id));
        },
        undoUnconfirmed: () => world.undone,
        countUndoable: () => world.undoable,
        isBusy: () => world.busy,
        autoAssignDistance: () => world.autoAssign,
        readFlag: key => world.flags.get(key) ?? null,
        writeFlag: (key, value) => { world.flags.set(key, value); },
        now: () => world.now,
        ...overrides,
    };
    const service = new RematchService(deps, { batchSize: options.batchSize ?? 2, minIntervalMs: options.minIntervalMs ?? 30 * MINUTE });
    return { world, service, deps };
}

/** Runs ticks until the run is over (or the guard trips). */
async function runToEnd(service: RematchService, guard = 50) {
    for (let i = 0; i < guard && service.getStatus().running; i++) await service.tick();
}

describe('RematchService', () => {
    describe('a run', () => {
        it('matches every unassigned face within the setting\'s distance and saves the matches', async () => {
            const { world, service } = setup({
                answers: { 1: { personId: 7, distance: 0.5 }, 3: { personId: 8, distance: 0.64 }, 4: { personId: 7, distance: 0.7 } },
            });

            expect(service.startRun()).toEqual({ started: true });
            await runToEnd(service);

            expect(world.saved).toEqual([
                { faceId: 1, personId: 7, distance: 0.5 },
                { faceId: 3, personId: 8, distance: 0.64 },
            ]);
            expect(new Set(world.matcherThresholds)).toEqual(new Set([0.65]));
        });

        it('uses the distance chosen on the card as it is when the run starts', async () => {
            const { world, service } = setup({ answers: { 1: { personId: 7, distance: 0.7 } } });
            service.setDistance(0.75);

            service.startRun();
            service.setDistance(0.5);
            await runToEnd(service);

            expect(world.saved).toEqual([{ faceId: 1, personId: 7, distance: 0.7 }]);
            expect(new Set(world.matcherThresholds)).toEqual(new Set([0.75]));
        });

        it('reads the faces in small pages by id, one page per step', async () => {
            const { world, service } = setup({ faces: [1, 2, 3, 4, 5] });

            service.startRun();
            await service.tick();

            expect(service.getStatus()).toMatchObject({ running: true, checked: 2, total: 5 });
            expect(world.pageRequests).toEqual([{ afterId: 0, limit: 2 }]);

            await runToEnd(service);
            expect(world.pageRequests.map(r => r.afterId)).toEqual([0, 2, 4, 5]);
        });

        it('does not assign a face to a person it was already re-matched to, but does to another person', async () => {
            const { world, service } = setup({
                faces: [1, 2],
                answers: { 1: { personId: 7, distance: 0.5 }, 2: { personId: 9, distance: 0.5 } },
                tried: ['1:7', '2:7'],
            });

            service.startRun();
            await runToEnd(service);

            expect(world.saved).toEqual([{ faceId: 2, personId: 9, distance: 0.5 }]);
        });

        it('skips a face whose descriptor is not the expected length', async () => {
            const { world, service, deps } = setup({ faces: [1, 2], answers: { 1: { personId: 7, distance: 0.5 }, 2: { personId: 7, distance: 0.5 } } });
            const original = deps.loadFaces;
            deps.loadFaces = (afterId, limit) => original(afterId, limit).map(f => (f.id === 1 ? { ...f, descriptor: Buffer.alloc(12) } : f));

            service.startRun();
            await runToEnd(service);

            expect(world.saved).toEqual([{ faceId: 2, personId: 7, distance: 0.5 }]);
        });

        it('finishes with a record of what it did and stops running', async () => {
            const { world, service } = setup({ answers: { 1: { personId: 7, distance: 0.5 }, 2: { personId: 7, distance: 0.5 } } });

            service.startRun();
            await runToEnd(service);

            expect(service.getStatus()).toMatchObject({
                running: false,
                lastRun: { matched: 2, checked: 5, completedAt: new Date(world.now).toISOString() },
            });
        });

        it('has nothing to do when there are no unassigned faces', async () => {
            const { service } = setup({ faces: [] });

            service.startRun();
            await runToEnd(service);

            expect(service.getStatus()).toMatchObject({ running: false, lastRun: { matched: 0, checked: 0 } });
        });
    });

    describe('manual start', () => {
        it('refuses when nobody is named', () => {
            const { service } = setup({ people: [] });
            expect(service.startRun()).toEqual({ started: false, reason: 'nobody-named' });
        });

        it('refuses while a scan or AI work is running', () => {
            const { world, service } = setup();
            world.busy = true;
            expect(service.startRun()).toEqual({ started: false, reason: 'busy' });
        });

        it('refuses a second start while a run is under way', async () => {
            const { service } = setup();
            service.startRun();
            await service.tick();
            expect(service.startRun()).toEqual({ started: false, reason: 'already-running' });
        });
    });

    describe('while other work is running', () => {
        it('makes no progress, and carries on from the same place afterwards', async () => {
            const { world, service } = setup({ answers: { 5: { personId: 7, distance: 0.5 } } });
            service.startRun();
            await service.tick();
            world.busy = true;

            await service.tick();
            await service.tick();
            expect(service.getStatus().checked).toBe(2);

            world.busy = false;
            await runToEnd(service);
            expect(world.saved).toEqual([{ faceId: 5, personId: 7, distance: 0.5 }]);
            expect(service.getStatus().lastRun?.checked).toBe(5);
        });

        it('resumes after a restart from the stored position', async () => {
            const first = setup({ answers: { 5: { personId: 7, distance: 0.5 } } });
            first.service.startRun();
            await first.service.tick();
            await first.service.tick();

            const restarted = new RematchService(first.deps, { batchSize: 2, minIntervalMs: 30 * MINUTE });
            expect(restarted.getStatus()).toMatchObject({ running: true, checked: 4 });
            await runToEnd(restarted);

            expect(first.world.saved).toEqual([{ faceId: 5, personId: 7, distance: 0.5 }]);
            expect(restarted.getStatus().running).toBe(false);
        });

        it('makes no automatic start while busy', async () => {
            const { world, service } = setup();
            world.busy = true;

            await service.tick();

            expect(service.getStatus().running).toBe(false);
        });
    });

    describe('automatic start', () => {
        it('starts when it has never run and someone is named', async () => {
            const { service } = setup();
            await service.tick();
            expect(service.getStatus().running).toBe(true);
        });

        it('does not start when nobody is named', async () => {
            const { service } = setup({ people: [] });
            await service.tick();
            expect(service.getStatus().running).toBe(false);
        });

        it('does not start when the switch is off', async () => {
            const { service } = setup();
            service.setAutoEnabled(false);
            await service.tick();
            expect(service.getStatus()).toMatchObject({ running: false, autoEnabled: false });
        });

        it('keeps the switch across a restart, and it is on by default', () => {
            const first = setup();
            expect(first.service.getStatus().autoEnabled).toBe(true);
            first.service.setAutoEnabled(false);

            const restarted = new RematchService(first.deps);

            expect(restarted.getStatus().autoEnabled).toBe(false);
        });

        it('does not start again when neither the people nor the distance changed', async () => {
            const { world, service } = setup({ faces: [1] });
            service.startRun();
            await runToEnd(service);
            world.now += 24 * 60 * MINUTE;
            world.faces = [2];

            await service.tick();

            expect(service.getStatus().running).toBe(false);
        });

        it('starts again when the named people changed, but not before the minimum interval', async () => {
            const { world, service } = setup({ faces: [1] }, {}, { minIntervalMs: 30 * MINUTE });
            service.startRun();
            await runToEnd(service);
            world.fingerprint = 'people-v2';

            world.now += 10 * MINUTE;
            await service.tick();
            expect(service.getStatus().running).toBe(false);

            world.now += 25 * MINUTE;
            await service.tick();
            expect(service.getStatus().running).toBe(true);
        });

        it('starts again when the distance setting changed', async () => {
            const { world, service } = setup({ faces: [1] });
            service.startRun();
            await runToEnd(service);
            service.setDistance(0.7);
            world.now += 31 * MINUTE;

            await service.tick();

            expect(service.getStatus().running).toBe(true);
        });
    });

    describe('distance', () => {
        it('is 0.65 when the Auto-Assign setting is 0.65 and the user chose nothing', () => {
            const { service } = setup();
            expect(service.getStatus().threshold).toBe(0.65);
        });

        it('follows the Auto-Assign setting until the user chooses another', () => {
            const { world, service } = setup();
            world.autoAssign = 0.7;

            expect(service.getStatus()).toMatchObject({ threshold: 0.7, followsAutoAssign: true });
        });

        it.each([[1.0, 0.8], [0.9, 0.8], [0.3, 0.4]])('limits an Auto-Assign value of %s to %s', (autoAssign, expected) => {
            const { world, service } = setup();
            world.autoAssign = autoAssign;

            expect(service.getStatus().threshold).toBe(expected);
        });

        it.each([Number.NaN, 0, -1])('uses 0.65 when the Auto-Assign value is %s', autoAssign => {
            const { world, service } = setup();
            world.autoAssign = autoAssign;

            expect(service.getStatus().threshold).toBe(0.65);
        });

        it('a distance the user chose wins over the Auto-Assign setting', () => {
            const { world, service } = setup();
            world.autoAssign = 0.7;
            service.setDistance(0.55);

            expect(service.getStatus()).toMatchObject({ threshold: 0.55, followsAutoAssign: false });
        });

        it('goes back to following the Auto-Assign setting when the choice is cleared', () => {
            const { world, service } = setup();
            world.autoAssign = 0.7;
            service.setDistance(0.55);

            expect(service.setDistance(null)).toBe(true);
            expect(service.getStatus()).toMatchObject({ threshold: 0.7, followsAutoAssign: true });
        });

        it('runs with the Auto-Assign distance as it is when the run starts', async () => {
            const { world, service } = setup({ answers: { 1: { personId: 7, distance: 0.69 } } });
            world.autoAssign = 0.7;
            service.startRun();
            world.autoAssign = 0.5;
            await runToEnd(service);

            expect(world.saved).toEqual([{ faceId: 1, personId: 7, distance: 0.69 }]);
        });

        it('starts an automatic run when the Auto-Assign setting changed since the last run', async () => {
            const { world, service } = setup();
            service.startRun();
            await runToEnd(service);
            world.now += 31 * MINUTE;
            await service.tick();
            expect(service.getStatus().running).toBe(false);

            world.autoAssign = 0.7;
            await service.tick();

            expect(service.getStatus().running).toBe(true);
        });

        it('keeps the chosen distance across a restart', () => {
            const first = setup();
            first.service.setDistance(0.7);

            expect(new RematchService(first.deps).getStatus().threshold).toBe(0.7);
        });

        it.each([0.4, 0.55, 0.8])('accepts %s', value => {
            const { service } = setup();
            expect(service.setDistance(value)).toBe(true);
            expect(service.getStatus().threshold).toBe(value);
        });

        it.each([0.39, 0.81, 0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s and keeps the old distance', value => {
            const { service } = setup();
            service.setDistance(0.7);

            expect(service.setDistance(value)).toBe(false);
            expect(service.getStatus().threshold).toBe(0.7);
        });

        it('ignores a stored value that is out of range or not a number', () => {
            const { world, service } = setup();
            world.flags.set('rematch_distance', '3.5');
            expect(service.getStatus().threshold).toBe(0.65);
            world.flags.set('rematch_distance', 'abc');
            expect(service.getStatus().threshold).toBe(0.65);
        });

        it('shows the run\'s own distance while running', async () => {
            const { service } = setup();
            service.setDistance(0.7);
            service.startRun();
            service.setDistance(0.5);

            expect(service.getStatus().threshold).toBe(0.7);
        });
    });

    describe('a failure', () => {
        it('ends the run, reports the error, and does not retry until the people or distance change', async () => {
            const { world, service } = setup({ answers: { 1: { personId: 7, distance: 0.5 } } });
            world.failMatching = true;
            service.startRun();

            await service.tick();

            expect(service.getStatus()).toMatchObject({ running: false, lastRun: { error: 'matcher broke' } });

            world.failMatching = false;
            world.now += 24 * 60 * MINUTE;
            await service.tick();
            expect(service.getStatus().running).toBe(false);

            world.fingerprint = 'people-v2';
            await service.tick();
            expect(service.getStatus().running).toBe(true);
        });
    });

    describe('undo', () => {
        it('returns the number of faces handed back and reports how many can still be undone', () => {
            const { world, service } = setup();
            world.undone = 12;
            world.undoable = 12;
            expect(service.getStatus().undoable).toBe(12);

            expect(service.undo()).toBe(12);
        });

        it('also switches the automatic runs off, so the faces it returned do not come straight back', () => {
            const { world, service } = setup();
            world.undone = 5;

            service.undo();

            expect(service.getStatus().autoEnabled).toBe(false);
        });

        it('leaves the automatic switch alone when there was nothing to undo', () => {
            const { service } = setup();

            service.undo();

            expect(service.getStatus().autoEnabled).toBe(true);
        });

        it('is refused while a run is under way', async () => {
            const { world, service } = setup();
            world.undone = 3;
            service.startRun();
            await service.tick();

            expect(service.undo()).toBe(0);
        });
    });

    describe('status', () => {
        it('shows the distance in use and progress', async () => {
            const { service } = setup({ answers: { 1: { personId: 7, distance: 0.5 } } });
            expect(service.getStatus()).toMatchObject({ running: false, threshold: 0.65, checked: 0, total: 0, matched: 0, lastRun: null });

            service.startRun();
            await service.tick();

            expect(service.getStatus()).toMatchObject({ running: true, checked: 2, total: 5, matched: 1 });
        });
    });
});
