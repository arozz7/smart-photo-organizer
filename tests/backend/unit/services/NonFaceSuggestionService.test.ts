import { describe, it, expect, beforeEach } from 'vitest';
import {
    NonFaceSuggestionService,
    DEFAULT_CUTOFF,
    MIN_CUTOFF,
    MAX_CUTOFF,
    CUTOFF_CHOICES,
    MAX_IDS_PER_ACTION,
    type NonFaceDeps,
} from '../../../../electron/core/services/NonFaceSuggestionService';
import type { NonFaceCount, NonFaceTile } from '../../../../electron/data/repositories/FlagRepository';

/** An in-memory stand-in for the database: scores by face id, plus the lists the repository would keep. */
function makeWorld(scores: Record<number, number>) {
    const flags = new Map<string, string>();
    const ignored = new Set<number>();
    const kept = new Set<number>();
    const calls = { ignore: [] as number[][], dismiss: [] as number[][], restore: [] as number[][], list: [] as number[][] };
    const suggested = (cutoff: number) => Object.keys(scores).map(Number).filter(id => scores[id] < cutoff && !ignored.has(id) && !kept.has(id));
    const deps: NonFaceDeps = {
        countBelow: cutoffs => cutoffs.map((cutoff): NonFaceCount => ({ cutoff, total: suggested(cutoff).length, turned: 0 })),
        list: (cutoff, offset, limit) => {
            calls.list.push([cutoff, offset, limit]);
            return suggested(cutoff).slice(offset, offset + limit).map(id => ({ faceId: id, score: scores[id] }) as NonFaceTile);
        },
        ignore: (ids, cutoff) => { calls.ignore.push(ids); const ok = ids.filter(id => suggested(cutoff).includes(id)); ok.forEach(id => ignored.add(id)); return ok; },
        dismiss: (ids, cutoff) => { calls.dismiss.push(ids); const ok = ids.filter(id => suggested(cutoff).includes(id)); ok.forEach(id => kept.add(id)); return ok.length; },
        restore: ids => { calls.restore.push(ids); const ok = ids.filter(id => ignored.has(id)); ok.forEach(id => ignored.delete(id)); return ok; },
        countIgnored: () => ignored.size,
        readFlag: key => flags.get(key) ?? null,
        writeFlag: (key, value) => { if (value === null) flags.delete(key); else flags.set(key, value); },
        now: () => '2026-11-19T10:00:00Z',
    };
    return { deps, flags, ignored, kept, calls };
}

describe('NonFaceSuggestionService', () => {
    let world: ReturnType<typeof makeWorld>;
    let service: NonFaceSuggestionService;
    beforeEach(() => {
        world = makeWorld({ 1: 0.3, 2: 0.5, 3: 0.52, 4: 0.6, 5: 0.9 });
        service = new NonFaceSuggestionService(world.deps);
    });

    describe('overview', () => {
        it('starts at the default cut-off and reports its count, the counts of the other choices and nothing ignored yet', () => {
            const overview = service.getOverview();

            expect(overview.cutoff).toBe(DEFAULT_CUTOFF);
            expect(overview.current.total).toBe(3);
            expect(overview.choices.map(c => c.cutoff)).toEqual([...CUTOFF_CHOICES]);
            expect(overview.choices.find(c => c.cutoff === 0.65)?.total).toBe(4);
            expect(overview.ignoredFromList).toBe(0);
            expect(overview).toMatchObject({ minCutoff: MIN_CUTOFF, maxCutoff: MAX_CUTOFF, defaultCutoff: DEFAULT_CUTOFF });
        });

        it('reports a saved cut-off that is not one of the choices', () => {
            service.setCutoff(0.62);

            const overview = service.getOverview();

            expect(overview.cutoff).toBe(0.62);
            expect(overview.current.total).toBe(4);
        });

        it('falls back to the default when the saved value is missing, not a number, or out of range', () => {
            for (const saved of ['', 'abc', '0.05', '3', 'NaN']) {
                world.flags.set('nonface_cutoff', saved);
                expect(service.getOverview().cutoff).toBe(DEFAULT_CUTOFF);
            }
        });
    });

    describe('cut-off setting', () => {
        it('saves a valid cut-off rounded to two decimals and the list follows it', () => {
            expect(service.setCutoff(0.505)).toBe(true);

            expect(world.flags.get('nonface_cutoff')).toBe('0.51');
            expect(service.list(0, 10).map(t => t.faceId)).toEqual([1, 2]);
        });

        it('refuses a cut-off outside the allowed range and keeps the old one', () => {
            for (const bad of [MIN_CUTOFF - 0.01, MAX_CUTOFF + 0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
                expect(service.setCutoff(bad)).toBe(false);
            }
            expect(world.flags.has('nonface_cutoff')).toBe(false);
        });
    });

    describe('list', () => {
        it('lists at the current cut-off and clamps the page size and offset', () => {
            service.list(-5, 100000);

            expect(world.calls.list.at(-1)).toEqual([DEFAULT_CUTOFF, 0, 200]);
        });
    });

    describe('ignore, keep and undo', () => {
        it('ignores only the suggested faces and reports how many', () => {
            const result = service.ignore([1, 2, 5, 99]);

            expect(result.ignoredIds).toEqual([1, 2]);
            expect(world.ignored).toEqual(new Set([1, 2]));
            expect(service.getOverview().ignoredFromList).toBe(2);
        });

        it('keeps suggested faces so they are not offered again', () => {
            expect(service.keep([1, 5])).toEqual({ kept: 1 });
            expect(service.list(0, 10).map(t => t.faceId)).toEqual([2, 3]);
        });

        it('undoes exactly the faces it is given', () => {
            service.ignore([1, 2, 3]);

            expect(service.undo([1, 2])).toEqual({ restoredIds: [1, 2] });
            expect(world.ignored).toEqual(new Set([3]));
        });

        it('does nothing, and does not touch the store, for an empty list', () => {
            expect(service.ignore([])).toEqual({ ignoredIds: [] });
            expect(service.keep([])).toEqual({ kept: 0 });
            expect(service.undo([])).toEqual({ restoredIds: [] });
            expect(world.calls.ignore).toEqual([]);
            expect(world.calls.dismiss).toEqual([]);
            expect(world.calls.restore).toEqual([]);
        });

        it('drops duplicates and anything that is not a positive whole number, and refuses a list that is too long', () => {
            service.ignore([1, 1, -4, 2.5, 0, 2]);

            expect(world.calls.ignore).toEqual([[1, 2]]);
            expect(() => service.ignore(Array.from({ length: MAX_IDS_PER_ACTION + 1 }, (_, i) => i + 1))).toThrow(/too many/i);
        });
    });
});
