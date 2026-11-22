import logger from '../../logger';
import type { PictureCounts } from '../../data/repositories/PictureRepository';
import type { IgnoredPicture, PictureCount, PictureList, PictureTile, RestoredPicture } from '../../data/repositories/PictureListRepository';
import { pictureLogit, q1ForLikelihood } from './pictureModel';
import { LIKELIHOOD_CHOICES, MAX_LIKELIHOOD, MIN_LIKELIHOOD, likelihoodOf } from './visibilityModel';

/** Where the user's choices are kept (app state), so they survive a restart. */
const LIST_KEY = 'picture_list';
const LIKELIHOOD_KEY = 'picture_min_likelihood';
/** '0' switches hiding off; anything else (including nothing saved) means on. */
const HIDE_KEY = 'picture_hide_from_review';

/** The two lists: faces in Review Needed, and faces already assigned to people. */
export const PICTURE_LISTS = ['unassigned', 'assigned'] as const;
export const DEFAULT_LIST: PictureList = 'unassigned';
/** Measured in Phase C0 (docs/measurements/pictures.md): at 70% about four in five faces on the list are pictures. */
export const DEFAULT_PICTURE_LIKELIHOOD = 70;

export const MAX_PAGE_SIZE = 200;
/** One select-page action never covers more faces than this. */
export const MAX_IDS_PER_ACTION = 2000;

/** The store the lists read and write (repositories in the app, a fake in the tests) and the app's small settings store. */
export interface PictureSuggestionDeps {
    countAtLeast(minQ1s: number[]): PictureCount[];
    list(which: PictureList, minQ1: number, offset: number, limit: number): PictureTile[];
    idsToHide(minQ1: number): number[];
    ignore(ids: number[], minQ1: number, at: string): IgnoredPicture[];
    keep(ids: number[], minQ1: number, at: string): number;
    undo(ids: number[]): RestoredPicture[];
    countIgnored(): number;
    /** How far the background check has got. */
    checkProgress(): PictureCounts;
    /** Rebuilds a person's centroids after faces left them or came back. */
    recalculate(personId: number): Promise<void>;
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string | null): void;
    now(): string;
}

export interface PictureChoice {
    likelihood: number;
    unassigned: number;
    assigned: number;
}

export interface PictureOverview {
    list: PictureList;
    minLikelihood: number;
    defaultLikelihood: number;
    minAllowed: number;
    maxAllowed: number;
    /** What each likelihood choice would give in both lists, so the user sees what a change does before making it. */
    choices: PictureChoice[];
    /** The list now shown at the chosen likelihood. */
    current: { total: number };
    /** Both lists together at the chosen likelihood (the count on the tab). */
    suggestedTotal: number;
    /** Faces the check has answered for (or failed on), out of all it will look at; and the same for the assigned faces, which come first. */
    checked: number;
    candidates: number;
    assignedChecked: number;
    assignedCandidates: number;
    /** Faces these lists ignored that are still ignored. */
    ignoredFromList: number;
    hideFromReview: boolean;
    /** How many faces the unassigned list would hide from Review Needed, and how many it hides right now. */
    hideable: number;
    hiddenFromReview: number;
}

export type PictureListTile = PictureTile & { likelihood: number };

/**
 * "Possible pictures of faces" (docs/plans/pictures-suggestions-plan.md, Phase C): faces the vision model finds picture-like, in Review Needed
 * and among the faces already assigned to people. Nothing here changes a face by itself: the user sees the thumbnails and chooses (ignore as a
 * picture, keep as a real face, undo). Ignoring a picture that was assigned takes it out of that person, whose centroids are rebuilt.
 */
export class PictureSuggestionService {
    constructor(private readonly deps: PictureSuggestionDeps) {}

    // ---- settings ------------------------------------------------------------------------------------------------

    getList(): PictureList {
        const saved = this.deps.readFlag(LIST_KEY);
        return (PICTURE_LISTS as readonly string[]).includes(saved ?? '') ? (saved as PictureList) : DEFAULT_LIST;
    }

    /** Returns false (and changes nothing) for a list that does not exist. */
    setList(list: string): boolean {
        if (!(PICTURE_LISTS as readonly string[]).includes(list)) return false;
        this.deps.writeFlag(LIST_KEY, list);
        return true;
    }

    getMinLikelihood(): number {
        const saved = this.deps.readFlag(LIKELIHOOD_KEY);
        const value = saved === null ? Number.NaN : Number(saved);
        return isAllowedLikelihood(value) ? value : DEFAULT_PICTURE_LIKELIHOOD;
    }

    /** Returns false (and changes nothing) unless it is a whole percent from 50 to 95. */
    setMinLikelihood(percent: number): boolean {
        if (!isAllowedLikelihood(percent)) return false;
        this.deps.writeFlag(LIKELIHOOD_KEY, String(percent));
        return true;
    }

    isHidingFromReview(): boolean {
        return this.deps.readFlag(HIDE_KEY) !== '0';
    }

    setHideFromReview(hide: boolean): void {
        this.deps.writeFlag(HIDE_KEY, hide ? '1' : '0');
    }

    private minQ1(): number {
        return q1ForLikelihood(this.getMinLikelihood());
    }

    /** The unassigned faces Review Needed leaves out (the list at the chosen likelihood), none when hiding is off. Assigned faces are never hidden. */
    hiddenFromReviewIds(): number[] {
        return this.isHidingFromReview() ? this.deps.idsToHide(this.minQ1()) : [];
    }

    // ---- overview and list ---------------------------------------------------------------------------------------

    getOverview(): PictureOverview {
        const list = this.getList();
        const minLikelihood = this.getMinLikelihood();
        const percents = [...new Set([...LIKELIHOOD_CHOICES, minLikelihood])].sort((a, b) => a - b);
        const counts = this.deps.countAtLeast(percents.map(q1ForLikelihood));
        const byPercent = new Map(percents.map((percent, i): [number, PictureChoice] => [percent, { likelihood: percent, unassigned: counts[i]?.unassigned ?? 0, assigned: counts[i]?.assigned ?? 0 }]));
        const now = byPercent.get(minLikelihood) as PictureChoice;
        const progress = this.deps.checkProgress();
        const hideFromReview = this.isHidingFromReview();
        return {
            list,
            minLikelihood,
            defaultLikelihood: DEFAULT_PICTURE_LIKELIHOOD,
            minAllowed: MIN_LIKELIHOOD,
            maxAllowed: MAX_LIKELIHOOD,
            choices: LIKELIHOOD_CHOICES.map(percent => byPercent.get(percent) as PictureChoice),
            current: { total: list === 'assigned' ? now.assigned : now.unassigned },
            suggestedTotal: now.unassigned + now.assigned,
            checked: progress.scored + progress.failed,
            candidates: progress.candidates,
            assignedChecked: progress.assignedChecked,
            assignedCandidates: progress.assignedCandidates,
            ignoredFromList: this.deps.countIgnored(),
            hideFromReview,
            hideable: now.unassigned,
            hiddenFromReview: hideFromReview ? now.unassigned : 0,
        };
    }

    list(offset: number, limit: number): PictureListTile[] {
        const start = Math.max(0, Math.floor(offset) || 0);
        const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit) || 1));
        return this.deps.list(this.getList(), this.minQ1(), start, size).map(tile => ({ ...tile, likelihood: likelihoodOf(pictureLogit(tile.score)) * 100 }));
    }

    // ---- actions -------------------------------------------------------------------------------------------------

    /** Ignores the faces that are still suggestions as pictures; people who lost a face get their centroids rebuilt. The ids it changed come back for an exact Undo. */
    async ignore(ids: number[]): Promise<{ ignoredIds: number[] }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { ignoredIds: [] };
        const done = this.deps.ignore(wanted, this.minQ1(), this.deps.now());
        await this.rebuild(done.map(item => item.formerPersonId));
        return { ignoredIds: done.map(item => item.faceId) };
    }

    /** "These are real faces": they are not offered again. Nothing else changes. */
    async keep(ids: number[]): Promise<{ kept: number }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { kept: 0 };
        return { kept: this.deps.keep(wanted, this.minQ1(), this.deps.now()) };
    }

    /** Gives ignored faces back as they were; the people they return to are rebuilt. */
    async undo(ids: number[]): Promise<{ restoredIds: number[] }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { restoredIds: [] };
        const restored = this.deps.undo(wanted);
        await this.rebuild(restored.map(item => item.personId));
        return { restoredIds: restored.map(item => item.faceId) };
    }

    private async rebuild(personIds: (number | null)[]): Promise<void> {
        for (const personId of new Set(personIds.filter((id): id is number => id !== null))) {
            try {
                await this.deps.recalculate(personId);
            } catch (error) {
                logger.error(`[Pictures] Could not rebuild the centroids of person ${personId}: ${String(error)}`);
            }
        }
    }
}

function isAllowedLikelihood(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_LIKELIHOOD && value <= MAX_LIKELIHOOD;
}

/** Positive whole numbers only, each once. A list longer than one action may cover is refused, not cut. */
function cleanIds(ids: number[]): number[] {
    if (ids.length > MAX_IDS_PER_ACTION) throw new Error(`Too many faces in one action (the limit is ${MAX_IDS_PER_ACTION})`);
    return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
}
