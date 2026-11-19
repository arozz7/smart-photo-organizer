import type { NonFaceCount, NonFaceTile } from '../../data/repositories/FlagRepository';
import type { RankedCount, RankedTile } from '../../data/repositories/RankedNonFaceRepository';
import {
    DEFAULT_LIKELIHOOD,
    LIKELIHOOD_CHOICES,
    MAX_LIKELIHOOD,
    MIN_LIKELIHOOD,
    likelihoodOf,
    logitForLikelihood,
} from './visibilityModel';

/** Where the user's choices are kept (app state), so they survive a restart. */
const CUTOFF_KEY = 'nonface_cutoff';
const MODE_KEY = 'nonface_mode';
const LIKELIHOOD_KEY = 'nonface_min_likelihood';

/** Faces with a detector score below this are suggested as "not a face". 3,846 of 55,665 in the user's library (Phase A). */
export const DEFAULT_CUTOFF = 0.55;
export const MIN_CUTOFF = 0.3;
export const MAX_CUTOFF = 0.75;
/** The choices offered on the list, each shown with the number of faces it would suggest. */
export const CUTOFF_CHOICES = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7] as const;

/** Which list is shown: ranked by the detector score alone, or by the model and the detector together. */
export const LIST_MODES = ['detector', 'model'] as const;
export type ListMode = (typeof LIST_MODES)[number];
export const DEFAULT_MODE: ListMode = 'detector';

export const MAX_PAGE_SIZE = 200;
/** One select-page action never covers more faces than this (the list loads 150 at a time). */
export const MAX_IDS_PER_ACTION = 2000;

/** The model-ranked half of the store (RankedNonFaceRepository in the app, a fake in the tests). */
export interface RankedDeps {
    countAtLeast(minLogits: number[]): RankedCount[];
    list(minLogit: number, offset: number, limit: number): RankedTile[];
    ignore(ids: number[], minLogit: number, at: string): number[];
    keep(ids: number[], minLogit: number, at: string): number;
}

/** The store the suggestion lists read and write (repositories in the app, a fake in the tests) and the app's small settings store. */
export interface NonFaceDeps {
    countBelow(cutoffs: number[]): NonFaceCount[];
    list(cutoff: number, offset: number, limit: number): NonFaceTile[];
    ignore(ids: number[], cutoff: number, at: string): number[];
    dismiss(ids: number[], cutoff: number, at: string): number;
    restore(ids: number[]): number[];
    countIgnored(): number;
    ranked: RankedDeps;
    /** How many uncertain faces need the model, and how many it has looked at. */
    visibilityCounts(): { candidates: number; scored: number; failed: number };
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string | null): void;
    now(): string;
}

/** How many faces a list holds, and how many of those are turned 45 degrees or more. */
export interface ListCount {
    total: number;
    turned: number;
}

export interface DetectorOverview {
    cutoff: number;
    defaultCutoff: number;
    minCutoff: number;
    maxCutoff: number;
    /** The count for each cut-off the list offers, so the user sees what a change would do before making it. */
    choices: NonFaceCount[];
}

export interface ModelChoice extends ListCount {
    /** Percent: "at least this likely to be a non-face". */
    likelihood: number;
}

export interface ModelOverview {
    minLikelihood: number;
    defaultLikelihood: number;
    minAllowed: number;
    maxAllowed: number;
    choices: ModelChoice[];
    /** Uncertain faces the model has answered for (or failed on), out of all that need it: the list grows as this does. */
    checked: number;
    candidates: number;
}

export interface NonFaceOverview {
    mode: ListMode;
    /** The list now shown. */
    current: ListCount;
    /** Details of the shown list only (each count is a database query, so the other mode is not computed). */
    detector: DetectorOverview | null;
    model: ModelOverview | null;
    /** Faces these lists ignored that are still ignored. */
    ignoredFromList: number;
}

/** A tile of either list; the model list adds the model's answer and the likelihood (percent) it ranked by. */
export type SuggestionTile = NonFaceTile & { modelScore?: number; likelihood?: number };

/**
 * "Not a face" suggestions. Two lists: faces the detector itself was unsure about (a score below the user's cut-off), and,
 * once the model has looked at the uncertain faces, those that the model and detector together find at least as likely a
 * non-face as the user's choice. Nothing here ignores a face by itself; the user sees the thumbnails and chooses (ignore, keep, undo).
 */
export class NonFaceSuggestionService {
    constructor(private readonly deps: NonFaceDeps) {}

    // ---- settings ------------------------------------------------------------------------------------------------

    getMode(): ListMode {
        const saved = this.deps.readFlag(MODE_KEY);
        return (LIST_MODES as readonly string[]).includes(saved ?? '') ? (saved as ListMode) : DEFAULT_MODE;
    }

    /** Returns false (and changes nothing) for a mode that does not exist. */
    setMode(mode: string): boolean {
        if (!(LIST_MODES as readonly string[]).includes(mode)) return false;
        this.deps.writeFlag(MODE_KEY, mode);
        return true;
    }

    getCutoff(): number {
        const saved = this.deps.readFlag(CUTOFF_KEY);
        const value = saved === null ? Number.NaN : Number(saved);
        return isAllowedCutoff(value) ? value : DEFAULT_CUTOFF;
    }

    /** Returns false (and changes nothing) for a value outside the allowed range. */
    setCutoff(value: number): boolean {
        if (!isAllowedCutoff(value)) return false;
        this.deps.writeFlag(CUTOFF_KEY, String(Math.round(value * 100) / 100));
        return true;
    }

    getMinLikelihood(): number {
        const saved = this.deps.readFlag(LIKELIHOOD_KEY);
        const value = saved === null ? Number.NaN : Number(saved);
        return isAllowedLikelihood(value) ? value : DEFAULT_LIKELIHOOD;
    }

    /** Returns false (and changes nothing) unless it is a whole percent from 50 to 95. */
    setMinLikelihood(percent: number): boolean {
        if (!isAllowedLikelihood(percent)) return false;
        this.deps.writeFlag(LIKELIHOOD_KEY, String(percent));
        return true;
    }

    // ---- overview and lists --------------------------------------------------------------------------------------

    getOverview(): NonFaceOverview {
        const mode = this.getMode();
        const ignoredFromList = this.deps.countIgnored();
        return mode === 'model'
            ? { mode, ignoredFromList, detector: null, ...this.modelOverview() }
            : { mode, ignoredFromList, model: null, ...this.detectorOverview() };
    }

    private detectorOverview(): { current: ListCount; detector: DetectorOverview } {
        const cutoff = this.getCutoff();
        const wanted = [...new Set([...CUTOFF_CHOICES, cutoff])].sort((a, b) => a - b);
        const byCutoff = new Map(this.deps.countBelow(wanted).map(c => [c.cutoff, c]));
        const countFor = (value: number): NonFaceCount => byCutoff.get(value) ?? { cutoff: value, total: 0, turned: 0 };
        const current = countFor(cutoff);
        return {
            current: { total: current.total, turned: current.turned },
            detector: {
                cutoff,
                defaultCutoff: DEFAULT_CUTOFF,
                minCutoff: MIN_CUTOFF,
                maxCutoff: MAX_CUTOFF,
                choices: CUTOFF_CHOICES.map(countFor),
            },
        };
    }

    private modelOverview(): { current: ListCount; model: ModelOverview } {
        const minLikelihood = this.getMinLikelihood();
        const percents = [...new Set([...LIKELIHOOD_CHOICES, minLikelihood])].sort((a, b) => a - b);
        const counts = this.deps.ranked.countAtLeast(percents.map(logitForLikelihood));
        const byPercent = new Map(percents.map((percent, i): [number, ModelChoice] => [percent, { likelihood: percent, total: counts[i]?.total ?? 0, turned: counts[i]?.turned ?? 0 }]));
        const { candidates, scored, failed } = this.deps.visibilityCounts();
        const current = byPercent.get(minLikelihood) ?? { likelihood: minLikelihood, total: 0, turned: 0 };
        return {
            current: { total: current.total, turned: current.turned },
            model: {
                minLikelihood,
                defaultLikelihood: DEFAULT_LIKELIHOOD,
                minAllowed: MIN_LIKELIHOOD,
                maxAllowed: MAX_LIKELIHOOD,
                choices: LIKELIHOOD_CHOICES.map(percent => byPercent.get(percent) as ModelChoice),
                checked: scored + failed,
                candidates,
            },
        };
    }

    list(offset: number, limit: number): SuggestionTile[] {
        const start = Math.max(0, Math.floor(offset) || 0);
        const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit) || 1));
        if (this.getMode() === 'detector') return this.deps.list(this.getCutoff(), start, size);
        return this.deps.ranked.list(this.minLogit(), start, size).map(({ logit, ...tile }) => ({ ...tile, likelihood: likelihoodOf(logit) * 100 }));
    }

    private minLogit(): number {
        return logitForLikelihood(this.getMinLikelihood());
    }

    // ---- actions -------------------------------------------------------------------------------------------------

    /** Ignores the faces that are still suggestions; the ids it changed come back so the page can offer an exact undo. */
    ignore(ids: number[]): { ignoredIds: number[] } {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { ignoredIds: [] };
        const at = this.deps.now();
        return { ignoredIds: this.getMode() === 'model' ? this.deps.ranked.ignore(wanted, this.minLogit(), at) : this.deps.ignore(wanted, this.getCutoff(), at) };
    }

    /** "These are faces, keep them": they are not offered again (by either list). */
    keep(ids: number[]): { kept: number } {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { kept: 0 };
        const at = this.deps.now();
        return { kept: this.getMode() === 'model' ? this.deps.ranked.keep(wanted, this.minLogit(), at) : this.deps.dismiss(wanted, this.getCutoff(), at) };
    }

    undo(ids: number[]): { restoredIds: number[] } {
        const wanted = cleanIds(ids);
        return { restoredIds: wanted.length ? this.deps.restore(wanted) : [] };
    }
}

function isAllowedCutoff(value: number): boolean {
    return Number.isFinite(value) && value >= MIN_CUTOFF && value <= MAX_CUTOFF;
}

function isAllowedLikelihood(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_LIKELIHOOD && value <= MAX_LIKELIHOOD;
}

/** Positive whole numbers only, each once. A list longer than one action may cover is refused, not cut. */
function cleanIds(ids: number[]): number[] {
    if (ids.length > MAX_IDS_PER_ACTION) throw new Error(`Too many faces in one action (the limit is ${MAX_IDS_PER_ACTION})`);
    return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
}
