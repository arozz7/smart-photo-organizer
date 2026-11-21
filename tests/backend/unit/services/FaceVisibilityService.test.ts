import { describe, it, expect, beforeEach } from 'vitest';
import {
    FaceVisibilityService,
    DEFAULT_MODE,
    DEFAULT_AWAY_MINUTES,
    MIN_AWAY_MINUTES,
    MAX_AWAY_MINUTES,
    type FaceVisibilityDeps,
    type VisibilityFace,
    type VisibilityResult,
} from '../../../../electron/core/services/FaceVisibilityService';

const MINUTE = 60_000;

/** An in-memory stand-in for the database, the engine and the computer: every outside effect is a field the test can set. */
function makeWorld(faceIds: number[]) {
    const world = {
        due: [...faceIds],
        scored: new Map<number, number | null>(),
        flags: new Map<string, string>(),
        busy: false,
        idleSeconds: 3600,
        clock: 1_000_000_000_000,
        /** What the engine answers for a face (default: 1.5); a function can also throw to simulate a batch failure. */
        answer: ((face: VisibilityFace): VisibilityResult => ({ faceId: face.id, score: 1.5 })) as (face: VisibilityFace) => VisibilityResult | undefined,
        engineError: null as Error | null,
        batches: [] as number[][],
        deps: undefined as unknown as FaceVisibilityDeps,
    };
    world.deps = {
        counts: () => ({ candidates: faceIds.length, scored: [...world.scored.values()].filter(s => s !== null).length, failed: [...world.scored.values()].filter(s => s === null).length }),
        loadDue: limit => world.due.filter(id => !world.scored.has(id)).slice(0, limit).map(id => ({ id, imagePath: `p${id}.jpg`, photoWidth: 100, box: { x: 1, y: 1, width: 10, height: 10 } })),
        score: async faces => {
            world.batches.push(faces.map(f => f.id));
            if (world.engineError) throw world.engineError;
            return faces.map(world.answer).filter((r): r is VisibilityResult => r !== undefined);
        },
        save: results => results.forEach(r => world.scored.set(r.faceId, r.score)),
        isBusy: () => world.busy,
        idleSeconds: () => world.idleSeconds,
        readFlag: key => world.flags.get(key) ?? null,
        writeFlag: (key, value) => { world.flags.set(key, value); },
        now: () => world.clock,
    };
    return world;
}

describe('FaceVisibilityService', () => {
    let world: ReturnType<typeof makeWorld>;
    let service: FaceVisibilityService;
    beforeEach(() => {
        world = makeWorld(Array.from({ length: 20 }, (_, i) => i + 1));
        service = new FaceVisibilityService(world.deps, { batchSize: 8 });
    });

    describe('settings', () => {
        it('defaults to running only when the user is away, after five minutes', () => {
            const status = service.getStatus();

            expect(DEFAULT_MODE).toBe('away');
            expect(status.mode).toBe('away');
            expect(status.awayMinutes).toBe(DEFAULT_AWAY_MINUTES);
        });

        it('saves a valid mode and away time', () => {
            expect(service.setMode('always')).toBe(true);
            expect(service.setAwayMinutes(10)).toBe(true);

            expect(service.getStatus()).toMatchObject({ mode: 'always', awayMinutes: 10 });
        });

        it.each(['sometimes', '', 'AWAY'])('refuses the mode %j and keeps the old one', mode => {
            expect(service.setMode(mode)).toBe(false);
            expect(service.getStatus().mode).toBe('away');
        });

        it.each([MIN_AWAY_MINUTES - 1, MAX_AWAY_MINUTES + 1, 2.5, Number.NaN])('refuses an away time of %s', minutes => {
            expect(service.setAwayMinutes(minutes)).toBe(false);
            expect(service.getStatus().awayMinutes).toBe(DEFAULT_AWAY_MINUTES);
        });

        it('falls back to the defaults when the stored values are unusable', () => {
            world.flags.set('visibility_mode', 'bogus');
            world.flags.set('visibility_away_minutes', '-3');

            expect(service.getStatus()).toMatchObject({ mode: DEFAULT_MODE, awayMinutes: DEFAULT_AWAY_MINUTES });
        });
    });

    describe('when it works', () => {
        it('scores one batch per step, in order, when the user is away and nothing else is running', async () => {
            await service.tick();

            expect(world.batches).toEqual([[1, 2, 3, 4, 5, 6, 7, 8]]);
            expect(world.scored.size).toBe(8);
        });

        it('does nothing while switched off', async () => {
            service.setMode('off');

            await service.tick();

            expect(world.batches).toEqual([]);
            expect(service.getStatus().state).toBe('off');
        });

        it('waits while a scan or AI work is running, in every mode', async () => {
            world.busy = true;
            for (const mode of ['away', 'always']) {
                service.setMode(mode);
                await service.tick();
            }

            expect(world.batches).toEqual([]);
            expect(service.getStatus().state).toBe('waiting-busy');
        });

        it('in "away" mode waits until the computer has been idle long enough, and stops again when the user returns', async () => {
            world.idleSeconds = 4 * 60;
            await service.tick();
            expect(world.batches).toEqual([]);
            expect(service.getStatus().state).toBe('waiting-away');

            world.idleSeconds = 5 * 60;
            await service.tick();
            expect(world.batches).toHaveLength(1);

            world.idleSeconds = 2;
            await service.tick();
            expect(world.batches).toHaveLength(1);
        });

        it('in "always" mode ignores how long the user has been idle', async () => {
            service.setMode('always');
            world.idleSeconds = 0;

            await service.tick();

            expect(world.batches).toHaveLength(1);
        });

        it('"Run now" works regardless of the mode or idle time, but still never while something else is running', async () => {
            service.setMode('off');
            world.idleSeconds = 0;

            expect(service.runNow()).toEqual({ started: true });
            await service.tick();
            expect(world.batches).toHaveLength(1);

            world.busy = true;
            await service.tick();
            expect(world.batches).toHaveLength(1);
        });

        it('"Run now" is refused while something else is running', () => {
            world.busy = true;

            expect(service.runNow()).toEqual({ started: false, reason: 'busy' });
        });

        it('"Run now" is refused when there is nothing left to score', () => {
            world.due = [];

            expect(service.runNow()).toEqual({ started: false, reason: 'nothing-to-do' });
        });

        it('"Run now" ends when everything is scored, and the mode applies again', async () => {
            service.setMode('off');
            service.runNow();
            for (let i = 0; i < 4; i++) await service.tick();
            expect(world.scored.size).toBe(20);

            world.due.push(21);
            await service.tick();

            expect(world.scored.size).toBe(20);
        });
    });

    describe('progress and resume', () => {
        it('reports how much is scored, failed and left', async () => {
            world.answer = face => (face.id === 2 ? { faceId: 2, score: null, error: 'no image' } : { faceId: face.id, score: 0.5 });
            await service.tick();

            expect(service.getStatus()).toMatchObject({ candidates: 20, scored: 7, failed: 1, remaining: 12 });
        });

        it('carries on where it stopped (a restart loses nothing) and never scores a face twice', async () => {
            await service.tick();
            const restarted = new FaceVisibilityService(world.deps, { batchSize: 8 });

            await restarted.tick();
            await restarted.tick();

            expect(world.batches).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16], [17, 18, 19, 20]]);
        });

        it('is done when nothing is left, and does not call the engine again', async () => {
            for (let i = 0; i < 3; i++) await service.tick();
            const calls = world.batches.length;

            await service.tick();

            expect(world.batches).toHaveLength(calls);
            expect(service.getStatus().state).toBe('done');
        });
    });

    describe('when the engine fails', () => {
        it('records a face the engine could not score as failed (it is not tried again) and carries on', async () => {
            world.answer = face => (face.id === 3 ? { faceId: 3, score: null, error: 'could not open' } : { faceId: face.id, score: 0.1 });

            await service.tick();

            expect(world.scored.get(3)).toBeNull();
            expect(world.scored.get(4)).toBe(0.1);
        });

        it('records a face the engine did not answer for as failed, so a step always makes progress', async () => {
            world.answer = face => (face.id === 5 ? undefined : { faceId: face.id, score: 0.1 });

            await service.tick();

            expect(world.scored.get(5)).toBeNull();
            expect(world.scored.size).toBe(8);
        });

        it('ignores a result for a face that was not asked about', async () => {
            const original = world.deps.score;
            world.deps.score = async faces => [...(await original(faces)), { faceId: 999, score: 9 }];

            await service.tick();

            expect(world.scored.has(999)).toBe(false);
        });

        it('keeps the faces unscored, shows the error and backs off when the whole batch fails', async () => {
            world.engineError = new Error('A GPU is required for this check');

            await service.tick();

            expect(world.scored.size).toBe(0);
            expect(service.getStatus()).toMatchObject({ state: 'error', lastError: 'A GPU is required for this check' });
        });

        it('does not retry before the back-off ends, then tries again', async () => {
            world.engineError = new Error('timeout');
            await service.tick();
            world.engineError = null;

            world.clock += 5 * MINUTE;
            await service.tick();
            expect(world.scored.size).toBe(0);

            world.clock += 30 * MINUTE;
            await service.tick();
            expect(world.scored.size).toBe(8);
            expect(service.getStatus().lastError).toBeNull();
        });

        it('"Run now" ends the back-off', async () => {
            world.engineError = new Error('timeout');
            await service.tick();
            world.engineError = null;

            expect(service.runNow()).toEqual({ started: true });
            await service.tick();

            expect(world.scored.size).toBe(8);
        });

        it('never throws, even when the idle time or the busy check cannot be read', async () => {
            world.deps.idleSeconds = () => { throw new Error('power monitor not ready'); };

            await expect(service.tick()).resolves.toBeUndefined();

            expect(world.batches).toEqual([]);
        });

        it('never throws, even when saving fails', async () => {
            world.deps.save = () => { throw new Error('database is locked'); };

            await expect(service.tick()).resolves.toBeUndefined();

            expect(service.getStatus().state).toBe('error');
        });
    });

    describe('a second check with its own settings (the picture check)', () => {
        it('keeps its mode and away time under its own keys, so the two checks are set separately', () => {
            const picture = new FaceVisibilityService(world.deps, { batchSize: 8, modeKey: 'picture_mode', awayKey: 'picture_away_minutes', logTag: 'PictureCheck' });

            picture.setMode('always');
            picture.setAwayMinutes(15);

            expect([...world.flags.entries()].sort()).toEqual([['picture_away_minutes', '15'], ['picture_mode', 'always']]);
            expect(picture.getStatus()).toMatchObject({ mode: 'always', awayMinutes: 15 });
            expect(service.getStatus()).toMatchObject({ mode: 'away', awayMinutes: DEFAULT_AWAY_MINUTES });
        });

        it('still uses the original keys when none are given', () => {
            service.setMode('off');
            service.setAwayMinutes(7);

            expect([...world.flags.entries()].sort()).toEqual([['visibility_away_minutes', '7'], ['visibility_mode', 'off']]);
        });
    });
});
