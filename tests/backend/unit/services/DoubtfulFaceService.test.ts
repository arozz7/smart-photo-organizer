import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    DoubtfulFaceService, DEFAULT_MIN_SCORE, DOUBT_CHOICES, MAX_IDS_PER_ACTION, type DoubtfulFaceDeps,
} from '../../../../electron/core/services/DoubtfulFaceService';

function makeDeps(overrides: Partial<DoubtfulFaceDeps> = {}) {
    const flags = new Map<string, string>();
    const deps: DoubtfulFaceDeps = {
        countAtLeast: vi.fn((scores: number[]) => scores.map(minScore => ({ minScore, total: Math.round(100 - minScore * 10) }))),
        peopleAtLeast: vi.fn(() => [{ personId: 7, name: 'Person 7', count: 40 }]),
        list: vi.fn(() => []),
        ignore: vi.fn(() => []),
        unassign: vi.fn(() => []),
        keep: vi.fn(() => 0),
        undo: vi.fn(() => []),
        countChanged: vi.fn(() => 0),
        checkProgress: vi.fn(() => ({ candidates: 200, scored: 150, failed: 10 })),
        recalculate: vi.fn(async () => undefined),
        readFlag: key => flags.get(key) ?? null,
        writeFlag: (key, value) => { if (value === null) flags.delete(key); else flags.set(key, value); },
        now: () => '2026-11-27T10:00:00Z',
        ...overrides,
    };
    return { deps, flags };
}

describe('DoubtfulFaceService', () => {
    let deps: DoubtfulFaceDeps;
    let flags: Map<string, string>;
    let service: DoubtfulFaceService;

    beforeEach(() => {
        ({ deps, flags } = makeDeps());
        service = new DoubtfulFaceService(deps);
    });

    describe('the cut-off', () => {
        it('starts at the default and keeps a saved whole number', () => {
            expect(service.getMinScore()).toBe(DEFAULT_MIN_SCORE);

            expect(service.setMinScore(4)).toBe(true);

            expect(service.getMinScore()).toBe(4);
        });

        it('refuses a value outside the range or not a whole number, and changes nothing', () => {
            expect(service.setMinScore(99)).toBe(false);
            expect(service.setMinScore(2.5)).toBe(false);

            expect(service.getMinScore()).toBe(DEFAULT_MIN_SCORE);
        });

        it('ignores a damaged saved value', () => {
            flags.set('doubtful_min_score', 'banana');

            expect(service.getMinScore()).toBe(DEFAULT_MIN_SCORE);
        });
    });

    describe('overview', () => {
        it('shows what each cut-off would give, the people at the chosen cut-off and how far the check has got', () => {
            const overview = service.getOverview();

            expect(overview.choices.map(c => c.score)).toEqual([...DOUBT_CHOICES]);
            expect(overview.current.total).toBe(Math.round(100 - DEFAULT_MIN_SCORE * 10));
            expect(overview.people).toEqual([{ personId: 7, name: 'Person 7', count: 40 }]);
            expect(overview).toMatchObject({ checked: 160, candidates: 200, minScore: DEFAULT_MIN_SCORE, changed: 0 });
        });

        it('includes a chosen cut-off that is not one of the usual choices', () => {
            service.setMinScore(6);

            expect(vi.mocked(deps.countAtLeast).mock.calls[0]?.[0] ?? []).toEqual([]);
            service.getOverview();
            expect(vi.mocked(deps.countAtLeast).mock.calls.at(-1)?.[0]).toContain(6);
        });
    });

    describe('list', () => {
        it('asks for a page at the chosen cut-off, for one person or all, and keeps the page size within bounds', () => {
            service.setMinScore(2);

            service.list(10, 5000, 7);

            expect(deps.list).toHaveBeenCalledWith(2, 7, 10, 200);
        });
    });

    describe('actions', () => {
        it('ignoring rebuilds each person who lost a face, once, and returns the ids it changed', async () => {
            deps = makeDeps({ ignore: vi.fn(() => [{ faceId: 1, formerPersonId: 7 }, { faceId: 2, formerPersonId: 7 }, { faceId: 3, formerPersonId: 8 }]) }).deps;
            service = new DoubtfulFaceService(deps);

            const result = await service.ignore([1, 2, 3]);

            expect(result).toEqual({ changedIds: [1, 2, 3] });
            expect(vi.mocked(deps.recalculate).mock.calls.map(([id]) => id).sort()).toEqual([7, 8]);
        });

        it('unassigning does the same', async () => {
            deps = makeDeps({ unassign: vi.fn(() => [{ faceId: 1, formerPersonId: 7 }]) }).deps;
            service = new DoubtfulFaceService(deps);

            expect(await service.unassign([1])).toEqual({ changedIds: [1] });
            expect(deps.recalculate).toHaveBeenCalledWith(7);
        });

        it('keeping changes no person', async () => {
            deps = makeDeps({ keep: vi.fn(() => 2) }).deps;
            service = new DoubtfulFaceService(deps);

            expect(await service.keep([1, 2])).toEqual({ kept: 2 });
            expect(deps.recalculate).not.toHaveBeenCalled();
        });

        it('undo rebuilds the people the faces went back to, but not for a face that came back unassigned', async () => {
            deps = makeDeps({ undo: vi.fn(() => [{ faceId: 1, personId: 7 }, { faceId: 2, personId: null }]) }).deps;
            service = new DoubtfulFaceService(deps);

            expect(await service.undo([1, 2])).toEqual({ restoredIds: [1, 2] });
            expect(vi.mocked(deps.recalculate).mock.calls).toEqual([[7]]);
        });

        it('does nothing for an empty or invalid list of ids, and cleans duplicates', async () => {
            expect(await service.ignore([])).toEqual({ changedIds: [] });
            expect(await service.ignore([0, -3, 1.5])).toEqual({ changedIds: [] });
            expect(deps.ignore).not.toHaveBeenCalled();

            await service.ignore([5, 5, 6]);
            expect(vi.mocked(deps.ignore).mock.calls[0]?.[0]).toEqual([5, 6]);
        });

        it('refuses more faces than one action may cover', async () => {
            const tooMany = Array.from({ length: MAX_IDS_PER_ACTION + 1 }, (_, i) => i + 1);

            await expect(service.ignore(tooMany)).rejects.toThrow('Too many faces');
        });

        it('keeps going when a person cannot be rebuilt', async () => {
            deps = makeDeps({
                ignore: vi.fn(() => [{ faceId: 1, formerPersonId: 7 }, { faceId: 2, formerPersonId: 8 }]),
                recalculate: vi.fn(async (id: number) => { if (id === 7) throw new Error('boom'); }),
            }).deps;
            service = new DoubtfulFaceService(deps);

            expect(await service.ignore([1, 2])).toEqual({ changedIds: [1, 2] });
            expect(deps.recalculate).toHaveBeenCalledWith(8);
        });
    });
});
