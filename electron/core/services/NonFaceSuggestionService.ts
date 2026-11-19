import type { NonFaceCount, NonFaceTile } from '../../data/repositories/FlagRepository';

/** Where the user's cut-off is kept (app state), so it survives a restart. */
const CUTOFF_KEY = 'nonface_cutoff';

/** Faces with a detector score below this are suggested as "not a face". 3,846 of 55,665 in the user's library (Phase A). */
export const DEFAULT_CUTOFF = 0.55;
export const MIN_CUTOFF = 0.3;
export const MAX_CUTOFF = 0.75;
/** The choices offered on the list, each shown with the number of faces it would suggest. */
export const CUTOFF_CHOICES = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7] as const;

export const MAX_PAGE_SIZE = 200;
/** One select-page action never covers more faces than this (the list loads 150 at a time). */
export const MAX_IDS_PER_ACTION = 2000;

/** The store the suggestion list reads and writes (FlagRepository in the app, a fake in the tests) and the app's small settings store. */
export interface NonFaceDeps {
    countBelow(cutoffs: number[]): NonFaceCount[];
    list(cutoff: number, offset: number, limit: number): NonFaceTile[];
    ignore(ids: number[], cutoff: number): number[];
    dismiss(ids: number[], cutoff: number, at: string): number;
    restore(ids: number[]): number[];
    countIgnored(): number;
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string | null): void;
    now(): string;
}

export interface NonFaceOverview {
    cutoff: number;
    defaultCutoff: number;
    minCutoff: number;
    maxCutoff: number;
    /** The suggestions at the saved cut-off, and how many of them are turned 45 degrees or more. */
    current: NonFaceCount;
    /** The same for each cut-off the list offers, so the user sees what a change would do before making it. */
    choices: NonFaceCount[];
    /** Faces this list ignored that are still ignored. */
    ignoredFromList: number;
}

/**
 * "Not a face" suggestions: faces the detector itself was unsure about (a score below the user's cut-off).
 * Nothing here ignores a face by itself; the user sees the thumbnails and chooses (ignore, keep, undo).
 */
export class NonFaceSuggestionService {
    constructor(private readonly deps: NonFaceDeps) {}

    getCutoff(): number {
        const saved = this.deps.readFlag(CUTOFF_KEY);
        const value = saved === null ? Number.NaN : Number(saved);
        return isAllowed(value) ? value : DEFAULT_CUTOFF;
    }

    /** Returns false (and changes nothing) for a value outside the allowed range. */
    setCutoff(value: number): boolean {
        if (!isAllowed(value)) return false;
        this.deps.writeFlag(CUTOFF_KEY, String(Math.round(value * 100) / 100));
        return true;
    }

    getOverview(): NonFaceOverview {
        const cutoff = this.getCutoff();
        const wanted = [...new Set([...CUTOFF_CHOICES, cutoff])].sort((a, b) => a - b);
        const counts = this.deps.countBelow(wanted);
        const byCutoff = new Map(counts.map(c => [c.cutoff, c]));
        return {
            cutoff,
            defaultCutoff: DEFAULT_CUTOFF,
            minCutoff: MIN_CUTOFF,
            maxCutoff: MAX_CUTOFF,
            current: byCutoff.get(cutoff) ?? { cutoff, total: 0, turned: 0 },
            choices: CUTOFF_CHOICES.map(choice => byCutoff.get(choice) ?? { cutoff: choice, total: 0, turned: 0 }),
            ignoredFromList: this.deps.countIgnored(),
        };
    }

    list(offset: number, limit: number): NonFaceTile[] {
        const start = Math.max(0, Math.floor(offset) || 0);
        const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit) || 1));
        return this.deps.list(this.getCutoff(), start, size);
    }

    /** Ignores the faces that are still suggestions; the ids it changed come back so the page can offer an exact undo. */
    ignore(ids: number[]): { ignoredIds: number[] } {
        const wanted = cleanIds(ids);
        return { ignoredIds: wanted.length ? this.deps.ignore(wanted, this.getCutoff()) : [] };
    }

    /** "These are faces, keep them": they are not offered again. */
    keep(ids: number[]): { kept: number } {
        const wanted = cleanIds(ids);
        return { kept: wanted.length ? this.deps.dismiss(wanted, this.getCutoff(), this.deps.now()) : 0 };
    }

    undo(ids: number[]): { restoredIds: number[] } {
        const wanted = cleanIds(ids);
        return { restoredIds: wanted.length ? this.deps.restore(wanted) : [] };
    }
}

function isAllowed(value: number): boolean {
    return Number.isFinite(value) && value >= MIN_CUTOFF && value <= MAX_CUTOFF;
}

/** Positive whole numbers only, each once. A list longer than one action may cover is refused, not cut. */
function cleanIds(ids: number[]): number[] {
    if (ids.length > MAX_IDS_PER_ACTION) throw new Error(`Too many faces in one action (the limit is ${MAX_IDS_PER_ACTION})`);
    return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
}
