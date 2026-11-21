import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import {
    PictureSuggestionService,
    DEFAULT_PICTURE_LIKELIHOOD,
    MAX_IDS_PER_ACTION,
    type PictureSuggestionDeps,
} from '../../../../electron/core/services/PictureSuggestionService';
import { LIKELIHOOD_CHOICES, MIN_LIKELIHOOD, MAX_LIKELIHOOD } from '../../../../electron/core/services/visibilityModel';
import { q1ForLikelihood } from '../../../../electron/core/services/pictureModel';
import type { PictureCount, PictureTile } from '../../../../electron/data/repositories/PictureListRepository';

/** A fake store: faces have a model answer (Q1), some are assigned to people. */
function makeWorld(q1: Record<number, number>, people: Record<number, number> = {}) {
    const flags = new Map<string, string>();
    const ignored = new Set<number>();
    const kept = new Set<number>();
    const calls = { ignore: [] as unknown[][], keep: [] as unknown[][], undo: [] as number[][], list: [] as unknown[][], recalculated: [] as number[] };
    const open = (id: number) => !ignored.has(id) && !kept.has(id);
    const at = (minQ1: number, assigned: boolean | null = null) =>
        Object.keys(q1).map(Number).filter(id => open(id) && q1[id] >= minQ1 && (assigned === null || (id in people) === assigned)).sort((a, b) => q1[b] - q1[a]);
    const deps: PictureSuggestionDeps = {
        countAtLeast: minQ1s => minQ1s.map((minQ1): PictureCount => ({ minQ1, unassigned: at(minQ1, false).length, assigned: at(minQ1, true).length })),
        list: (which, minQ1, offset, limit) => {
            calls.list.push([which, minQ1, offset, limit]);
            return at(minQ1, which === 'assigned').slice(offset, offset + limit).map(id => ({ faceId: id, score: q1[id], personId: people[id] ?? null }) as PictureTile);
        },
        idsToHide: minQ1 => at(minQ1, false),
        ignore: (ids, minQ1, atTime) => {
            calls.ignore.push([ids, minQ1, atTime]);
            const ok = ids.filter(id => at(minQ1).includes(id));
            ok.forEach(id => ignored.add(id));
            return ok.map(id => ({ faceId: id, formerPersonId: people[id] ?? null }));
        },
        keep: (ids, minQ1, atTime) => {
            calls.keep.push([ids, minQ1, atTime]);
            const ok = ids.filter(id => at(minQ1).includes(id));
            ok.forEach(id => kept.add(id));
            return ok.length;
        },
        undo: ids => {
            calls.undo.push(ids);
            const ok = ids.filter(id => ignored.has(id));
            ok.forEach(id => ignored.delete(id));
            return ok.map(id => ({ faceId: id, personId: people[id] ?? null }));
        },
        countIgnored: () => ignored.size,
        checkProgress: () => ({ candidates: 100, scored: 60, failed: 2, assignedCandidates: 12, assignedChecked: 12 }),
        recalculate: async personId => { calls.recalculated.push(personId); },
        readFlag: key => flags.get(key) ?? null,
        writeFlag: (key, value) => { if (value === null) flags.delete(key); else flags.set(key, value); },
        now: () => '2026-11-21T10:00:00Z',
    };
    return { deps, flags, ignored, kept, calls };
}

const MIN70 = q1ForLikelihood(70);

describe('PictureSuggestionService', () => {
    let world: ReturnType<typeof makeWorld>;
    let service: PictureSuggestionService;
    beforeEach(() => {
        // 1, 2: unassigned pictures; 3: an assigned face at the same level; 4: below the 70% cut-off; 5: assigned, high
        world = makeWorld({ 1: MIN70 + 1, 2: MIN70 + 0.2, 3: MIN70 + 0.1, 4: MIN70 - 1, 5: MIN70 + 2 }, { 3: 10, 5: 11 });
        service = new PictureSuggestionService(world.deps);
    });

    describe('settings', () => {
        it('starts on the unassigned list at 70%, with hiding from Review Needed on', () => {
            const overview = service.getOverview();

            expect(DEFAULT_PICTURE_LIKELIHOOD).toBe(70);
            expect(overview).toMatchObject({ list: 'unassigned', minLikelihood: 70, hideFromReview: true });
        });

        it('saves the list, the likelihood and the hiding choice', () => {
            expect(service.setList('assigned')).toBe(true);
            expect(service.setMinLikelihood(80)).toBe(true);
            service.setHideFromReview(false);

            expect(service.getOverview()).toMatchObject({ list: 'assigned', minLikelihood: 80, hideFromReview: false });
        });

        it('refuses a list that does not exist and a likelihood outside 50 to 95, keeping the old choice', () => {
            expect(service.setList('everything')).toBe(false);
            expect(service.setMinLikelihood(MIN_LIKELIHOOD - 1)).toBe(false);
            expect(service.setMinLikelihood(MAX_LIKELIHOOD + 1)).toBe(false);
            expect(service.setMinLikelihood(72.5)).toBe(false);

            expect(service.getOverview()).toMatchObject({ list: 'unassigned', minLikelihood: 70 });
        });

        it('falls back to the defaults when the saved values are not usable', () => {
            world.flags.set('picture_list', 'nonsense');
            world.flags.set('picture_min_likelihood', 'abc');

            expect(service.getOverview()).toMatchObject({ list: 'unassigned', minLikelihood: 70 });
        });
    });

    describe('overview', () => {
        it('counts both lists at every likelihood choice, so the user sees what a change would do', () => {
            const overview = service.getOverview();

            expect(overview.choices.map(c => c.likelihood)).toEqual([...LIKELIHOOD_CHOICES]);
            expect(overview.choices.find(c => c.likelihood === 70)).toMatchObject({ unassigned: 2, assigned: 2 });
            expect(overview.current).toEqual({ total: 2 });
            expect(overview.suggestedTotal).toBe(4);
        });

        it('shows the list now chosen as the current one', () => {
            service.setList('assigned');

            expect(service.getOverview().current).toEqual({ total: 2 });
            service.setMinLikelihood(95);
            expect(service.getOverview().current.total).toBeLessThanOrEqual(2);
        });

        it('reports how far the check has got, and that the assigned faces are done', () => {
            expect(service.getOverview()).toMatchObject({ checked: 62, candidates: 100, assignedChecked: 12, assignedCandidates: 12 });
        });

        it('says how many faces Review Needed hides, only while hiding is on', () => {
            expect(service.getOverview()).toMatchObject({ hiddenFromReview: 2 });

            service.setHideFromReview(false);
            expect(service.getOverview()).toMatchObject({ hiddenFromReview: 0, hideable: 2 });
        });

        it('counts the faces the lists ignored that are still ignored', () => {
            world.ignored.add(9);

            expect(service.getOverview().ignoredFromList).toBe(1);
        });
    });

    describe('list', () => {
        it('lists the unassigned faces at the cut-off with their likelihood in percent, most picture-like first', () => {
            const tiles = service.list(0, 10);

            expect(tiles.map(t => t.faceId)).toEqual([1, 2]);
            expect(tiles[0].likelihood).toBeGreaterThan(tiles[1].likelihood);
            expect(tiles[1].likelihood).toBeGreaterThan(70);
        });

        it('lists the assigned faces when that list is chosen, and clamps the page', () => {
            service.setList('assigned');

            expect(service.list(0, 10).map(t => t.faceId)).toEqual([5, 3]);
            service.list(-5, 100000);
            expect(world.calls.list.at(-1)).toEqual(['assigned', MIN70, 0, 200]);
        });
    });

    describe('hiding from Review Needed', () => {
        it('hides the unassigned list at the cut-off', () => {
            expect(service.hiddenFromReviewIds().sort()).toEqual([1, 2]);
        });

        it('follows the likelihood and stops when switched off, or when a face is kept or ignored', () => {
            service.setMinLikelihood(90);
            expect(service.hiddenFromReviewIds()).toEqual(world.deps.idsToHide(q1ForLikelihood(90)));

            service.setMinLikelihood(70);
            void service.keep([2]);
            expect(service.hiddenFromReviewIds()).toEqual([1]);

            service.setHideFromReview(false);
            expect(service.hiddenFromReviewIds()).toEqual([]);
        });
    });

    describe('ignore, keep and undo', () => {
        it('ignores the faces that are still suggestions at the cut-off and rebuilds each person who lost a face, once', async () => {
            service.setList('assigned');

            const result = await service.ignore([3, 5, 4]);

            expect(result.ignoredIds.sort()).toEqual([3, 5]);
            expect(world.calls.recalculated.sort()).toEqual([10, 11]);
        });

        it('does not rebuild anyone for faces that were not assigned', async () => {
            await service.ignore([1, 2]);

            expect(world.calls.recalculated).toEqual([]);
        });

        it('keeps faces as real faces without changing anything else', async () => {
            expect(await service.keep([1, 4])).toEqual({ kept: 1 });
            expect(world.calls.recalculated).toEqual([]);
        });

        it('undoes exactly the faces given and rebuilds the people they come back to', async () => {
            service.setList('assigned');
            await service.ignore([3]);
            world.calls.recalculated.length = 0;

            const result = await service.undo([3, 99]);

            expect(result.restoredIds).toEqual([3]);
            expect(world.calls.recalculated).toEqual([10]);
        });

        it('does nothing for an empty or invalid list, and refuses more faces than one action may cover', async () => {
            expect(await service.ignore([])).toEqual({ ignoredIds: [] });
            expect(await service.ignore([0, -1, 1.5, Number.NaN])).toEqual({ ignoredIds: [] });
            await expect(service.ignore(Array.from({ length: MAX_IDS_PER_ACTION + 1 }, (_, i) => i + 1))).rejects.toThrow(/Too many/);
            expect(world.calls.ignore).toEqual([]);
        });

        it('still reports the ignore when rebuilding a person fails', async () => {
            world.deps.recalculate = async () => { throw new Error('locked'); };
            service.setList('assigned');

            const result = await service.ignore([3]);

            expect(result.ignoredIds).toEqual([3]);
        });
    });
});
