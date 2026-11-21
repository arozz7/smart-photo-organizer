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
import { DEFAULT_LIKELIHOOD, LIKELIHOOD_CHOICES, MIN_LIKELIHOOD, MAX_LIKELIHOOD, logitForLikelihood, likelihoodOf } from '../../../../electron/core/services/visibilityModel';
import type { NonFaceCount, NonFaceTile } from '../../../../electron/data/repositories/FlagRepository';
import type { RankedCount, RankedTile } from '../../../../electron/data/repositories/RankedNonFaceRepository';

/**
 * An in-memory stand-in for the database. Faces have a detector score; some also have a "ranking number" (the log-odds of
 * not being a face that the model and detector give together), which is what the model list cuts on.
 */
function makeWorld(scores: Record<number, number>, logits: Record<number, number> = {}) {
    const flags = new Map<string, string>();
    const ignored = new Set<number>();
    const kept = new Set<number>();
    const turned = new Set<number>();
    const calls = {
        ignore: [] as number[][], dismiss: [] as number[][], restore: [] as number[][], list: [] as number[][],
        rankedIgnore: [] as unknown[][], rankedKeep: [] as unknown[][], rankedList: [] as number[][],
    };
    const open = (id: number) => !ignored.has(id) && !kept.has(id);
    const suggested = (cutoff: number) => Object.keys(scores).map(Number).filter(id => scores[id] < cutoff && open(id));
    const rankedSuggested = (minLogit: number) =>
        Object.keys(logits).map(Number).filter(id => open(id) && logits[id] >= minLogit).sort((a, b) => logits[b] - logits[a]);
    const deps: NonFaceDeps = {
        countBelow: cutoffs => cutoffs.map((cutoff): NonFaceCount => ({ cutoff, total: suggested(cutoff).length, turned: suggested(cutoff).filter(id => turned.has(id)).length })),
        list: (cutoff, offset, limit) => {
            calls.list.push([cutoff, offset, limit]);
            return suggested(cutoff).slice(offset, offset + limit).map(id => ({ faceId: id, score: scores[id] }) as NonFaceTile);
        },
        ignore: (ids, cutoff) => { calls.ignore.push(ids); const ok = ids.filter(id => suggested(cutoff).includes(id)); ok.forEach(id => ignored.add(id)); return ok; },
        dismiss: (ids, cutoff) => { calls.dismiss.push(ids); const ok = ids.filter(id => suggested(cutoff).includes(id)); ok.forEach(id => kept.add(id)); return ok.length; },
        restore: ids => { calls.restore.push(ids); const ok = ids.filter(id => ignored.has(id)); ok.forEach(id => ignored.delete(id)); return ok; },
        countIgnored: () => ignored.size,
        idsToHide: cutoff => suggested(cutoff).filter(id => !(turned.has(id))),
        ranked: {
            countAtLeast: minLogits => minLogits.map((minLogit): RankedCount => ({ minLogit, total: rankedSuggested(minLogit).length, turned: rankedSuggested(minLogit).filter(id => turned.has(id)).length })),
            idsToHide: minLogit => rankedSuggested(minLogit).filter(id => !turned.has(id)),
            list: (minLogit, offset, limit) => {
                calls.rankedList.push([minLogit, offset, limit]);
                return rankedSuggested(minLogit).slice(offset, offset + limit).map(id => ({ faceId: id, score: scores[id] ?? 0.3, modelScore: 2, logit: logits[id] }) as RankedTile);
            },
            ignore: (ids, minLogit, at) => { calls.rankedIgnore.push([ids, minLogit, at]); const ok = ids.filter(id => rankedSuggested(minLogit).includes(id)); ok.forEach(id => ignored.add(id)); return ok; },
            keep: (ids, minLogit, at) => { calls.rankedKeep.push([ids, minLogit, at]); const ok = ids.filter(id => rankedSuggested(minLogit).includes(id)); ok.forEach(id => kept.add(id)); return ok.length; },
        },
        visibilityCounts: () => ({ candidates: 100, scored: 40, failed: 2 }),
        readFlag: key => flags.get(key) ?? null,
        writeFlag: (key, value) => { if (value === null) flags.delete(key); else flags.set(key, value); },
        now: () => '2026-11-19T10:00:00Z',
    };
    return { deps, flags, ignored, kept, turned, calls };
}

describe('NonFaceSuggestionService', () => {
    let world: ReturnType<typeof makeWorld>;
    let service: NonFaceSuggestionService;
    beforeEach(() => {
        world = makeWorld({ 1: 0.3, 2: 0.5, 3: 0.52, 4: 0.6, 5: 0.9 });
        service = new NonFaceSuggestionService(world.deps);
    });

    describe('overview (detector list)', () => {
        it('starts in detector mode at the default cut-off and reports its count, the counts of the other choices and nothing ignored yet', () => {
            const overview = service.getOverview();

            expect(overview.mode).toBe('detector');
            expect(overview.model).toBeNull();
            expect(overview.detector?.cutoff).toBe(DEFAULT_CUTOFF);
            expect(overview.current.total).toBe(3);
            expect(overview.detector?.choices.map(c => c.cutoff)).toEqual([...CUTOFF_CHOICES]);
            expect(overview.detector?.choices.find(c => c.cutoff === 0.65)?.total).toBe(4);
            expect(overview.ignoredFromList).toBe(0);
            expect(overview.detector).toMatchObject({ minCutoff: MIN_CUTOFF, maxCutoff: MAX_CUTOFF, defaultCutoff: DEFAULT_CUTOFF });
        });

        it('reports a saved cut-off that is not one of the choices', () => {
            service.setCutoff(0.62);

            const overview = service.getOverview();

            expect(overview.detector?.cutoff).toBe(0.62);
            expect(overview.current.total).toBe(4);
        });

        it('falls back to the default when the saved value is missing, not a number, or out of range', () => {
            for (const saved of ['', 'abc', '0.05', '3', 'NaN']) {
                world.flags.set('nonface_cutoff', saved);
                expect(service.getOverview().detector?.cutoff).toBe(DEFAULT_CUTOFF);
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

    describe('model list', () => {
        const cut = (percent: number) => logitForLikelihood(percent);

        beforeEach(() => {
            world = makeWorld({ 1: 0.3, 2: 0.5, 3: 0.52, 4: 0.6, 5: 0.9 }, { 10: cut(95), 11: cut(85), 12: cut(75), 13: cut(65), 14: cut(55), 15: cut(10) });
            service = new NonFaceSuggestionService(world.deps);
        });

        it('defaults to the detector list; the mode is a saved setting', () => {
            expect(service.getOverview().mode).toBe('detector');

            expect(service.setMode('model')).toBe(true);

            expect(service.getOverview().mode).toBe('model');
            expect(world.flags.get('nonface_mode')).toBe('model');
        });

        it.each(['', 'ranked', 'MODEL', 'detector '])('refuses the mode %j', mode => {
            expect(service.setMode(mode)).toBe(false);
            expect(service.getOverview().mode).toBe('detector');
        });

        it('falls back to the detector list when the saved mode is unusable', () => {
            world.flags.set('nonface_mode', 'bogus');

            expect(service.getOverview().mode).toBe('detector');
        });

        it('reports the likelihood choices with their counts, the checked progress, and only the model details', () => {
            service.setMode('model');

            const overview = service.getOverview();

            expect(overview.detector).toBeNull();
            expect(overview.model?.minLikelihood).toBe(DEFAULT_LIKELIHOOD);
            expect(overview.model?.choices.map(c => c.likelihood)).toEqual([...LIKELIHOOD_CHOICES]);
            expect(overview.model?.choices.find(c => c.likelihood === 90)?.total).toBe(1);
            expect(overview.model?.choices.find(c => c.likelihood === 50)?.total).toBe(5);
            expect(overview.current.total).toBe(3);
            expect(overview.model?.checked).toBe(42);
            expect(overview.model?.candidates).toBe(100);
            expect(overview.model).toMatchObject({ minAllowed: MIN_LIKELIHOOD, maxAllowed: MAX_LIKELIHOOD, defaultLikelihood: DEFAULT_LIKELIHOOD });
        });

        it('saves a valid likelihood and the list follows it; a value outside the range is refused', () => {
            service.setMode('model');

            expect(service.setMinLikelihood(60)).toBe(true);
            expect(service.getOverview().current.total).toBe(4);
            for (const bad of [MIN_LIKELIHOOD - 1, MAX_LIKELIHOOD + 1, 72.5, Number.NaN]) {
                expect(service.setMinLikelihood(bad)).toBe(false);
            }
            expect(service.getOverview().model?.minLikelihood).toBe(60);
        });

        it('lists the most likely first and gives every tile its likelihood in percent', () => {
            service.setMode('model');

            const tiles = service.list(0, 10);

            expect(tiles.map(t => t.faceId)).toEqual([10, 11, 12]);
            expect(tiles[0].likelihood).toBeCloseTo(95, 6);
            expect(tiles[0].likelihood).toBeCloseTo(likelihoodOf(cut(95)) * 100, 6);
            expect(tiles[0]).toMatchObject({ modelScore: 2, score: 0.3 });
        });

        it('ignores and keeps through the model list with its cut-off, and undo is the same as for the detector list', () => {
            service.setMode('model');

            expect(service.ignore([10, 13]).ignoredIds).toEqual([10]);
            expect(service.keep([11, 14])).toEqual({ kept: 1 });
            expect(world.calls.rankedIgnore[0]).toEqual([[10, 13], cut(DEFAULT_LIKELIHOOD), '2026-11-19T10:00:00Z']);
            expect(world.calls.ignore).toEqual([]);
            expect(service.undo([10])).toEqual({ restoredIds: [10] });
        });

        it('does not touch the store for an empty list in model mode either', () => {
            service.setMode('model');

            service.ignore([]);
            service.keep([]);

            expect(world.calls.rankedIgnore).toEqual([]);
            expect(world.calls.rankedKeep).toEqual([]);
        });
    });

    describe('hiding the suggestions from Review Needed', () => {
        it('is on until the user turns it off', () => {
            expect(service.isHidingFromReview()).toBe(true);

            service.setHideFromReview(false);
            expect(service.isHidingFromReview()).toBe(false);

            service.setHideFromReview(true);
            expect(service.isHidingFromReview()).toBe(true);
        });

        it('hides the faces of the list now shown (detector cut-off), except the turned ones', () => {
            world.turned.add(2);

            expect(service.hiddenFromReviewIds().sort()).toEqual([1, 3]);
        });

        it('follows the list the user chose: the model list in model mode', () => {
            const modelWorld = makeWorld({ 1: 0.3, 2: 0.5, 3: 0.52, 4: 0.6 }, { 1: 5, 2: 4, 3: -3 });
            const modelService = new NonFaceSuggestionService(modelWorld.deps);
            modelWorld.turned.add(2);
            modelService.setMode('model');

            expect(modelService.hiddenFromReviewIds()).toEqual([1]);
        });

        it('changes with the cut-off, since the list does', () => {
            service.setCutoff(0.4);
            expect(service.hiddenFromReviewIds()).toEqual([1]);
            service.setCutoff(0.7);
            expect(service.hiddenFromReviewIds().sort()).toEqual([1, 2, 3, 4]);
        });

        it('hides nothing when it is off', () => {
            service.setHideFromReview(false);

            expect(service.hiddenFromReviewIds()).toEqual([]);
        });

        it('stops hiding a face once the user kept it or ignored it', () => {
            service.keep([1]);
            service.ignore([2]);

            expect(service.hiddenFromReviewIds()).toEqual([3]);
        });

        it('says in the overview how many faces it hides and how many it would hide (the list without its turned faces)', () => {
            world.turned.add(2);

            expect(service.getOverview()).toMatchObject({ hideFromReview: true, hideable: 2, hiddenFromReview: 2 });

            service.setHideFromReview(false);
            expect(service.getOverview()).toMatchObject({ hideFromReview: false, hideable: 2, hiddenFromReview: 0 });
        });
    });
});
