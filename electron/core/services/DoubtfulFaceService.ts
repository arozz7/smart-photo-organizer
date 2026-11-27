import logger from '../../logger';
import type { ChangedFace, DoubtfulCount, DoubtfulPerson, DoubtfulTile, RestoredFace } from '../../data/repositories/DoubtfulFaceRepository';
import type { VisibilityCounts } from '../../data/repositories/VisibilityRepository';

/** Where the user's cut-off is kept (app state), so it survives a restart. */
const MIN_SCORE_KEY = 'doubtful_min_score';

/**
 * The cut-offs the list offers, on the model's own scale ("higher means no clear face visible"; most faces score between -1 and 4).
 * They are not percentages: the model was calibrated on unassigned faces only, so no likelihood is claimed for assigned ones.
 */
export const DOUBT_CHOICES = [1, 2, 3, 4, 5] as const;
export const MIN_ALLOWED_SCORE = 0;
export const MAX_ALLOWED_SCORE = 6;
export const DEFAULT_MIN_SCORE = 3;

export const MAX_PAGE_SIZE = 200;
/** One select-page action never covers more faces than this. */
export const MAX_IDS_PER_ACTION = 2000;

/** The store the list reads and writes (repositories in the app, a fake in the tests) and the app's small settings store. */
export interface DoubtfulFaceDeps {
    countAtLeast(minScores: number[]): DoubtfulCount[];
    peopleAtLeast(minScore: number): DoubtfulPerson[];
    list(minScore: number, personId: number | null, offset: number, limit: number): DoubtfulTile[];
    ignore(ids: number[], minScore: number, at: string): ChangedFace[];
    unassign(ids: number[], minScore: number, at: string): ChangedFace[];
    keep(ids: number[], minScore: number, at: string): number;
    undo(ids: number[]): RestoredFace[];
    countChanged(): number;
    /** How far the background check has got. */
    checkProgress(): VisibilityCounts;
    /** Rebuilds a person's centroids after faces left them or came back. */
    recalculate(personId: number): Promise<void>;
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string | null): void;
    now(): string;
}

export interface DoubtfulChoice {
    score: number;
    total: number;
}

export interface DoubtfulOverview {
    minScore: number;
    defaultMinScore: number;
    minAllowed: number;
    maxAllowed: number;
    /** What each cut-off would give, so the user sees what a change does before making it. */
    choices: DoubtfulChoice[];
    /** The list at the chosen cut-off. */
    current: { total: number };
    /** The people with doubtful faces at the chosen cut-off, the one with the most first. */
    people: DoubtfulPerson[];
    /** Faces the check has answered for (or failed on), out of all it will look at. */
    checked: number;
    candidates: number;
    /** Faces this list changed that could still be undone. */
    changed: number;
}

/**
 * "Doubtful faces": faces already assigned to a person that the vision model finds show no clear face (animals, objects, hands, pictures).
 * Nothing here changes a face by itself: the user sees the thumbnails and chooses (not a face, back to suggestions, keep, undo). A face that
 * leaves its person takes that person's centroids with it, so they are rebuilt.
 */
export class DoubtfulFaceService {
    constructor(private readonly deps: DoubtfulFaceDeps) {}

    // ---- settings ------------------------------------------------------------------------------------------------

    getMinScore(): number {
        const saved = this.deps.readFlag(MIN_SCORE_KEY);
        const value = saved === null ? Number.NaN : Number(saved);
        return isAllowedScore(value) ? value : DEFAULT_MIN_SCORE;
    }

    /** Returns false (and changes nothing) unless it is a whole number from 0 to 6. */
    setMinScore(score: number): boolean {
        if (!isAllowedScore(score)) return false;
        this.deps.writeFlag(MIN_SCORE_KEY, String(score));
        return true;
    }

    // ---- overview and list ---------------------------------------------------------------------------------------

    getOverview(): DoubtfulOverview {
        const minScore = this.getMinScore();
        const scores = [...new Set([...DOUBT_CHOICES, minScore])].sort((a, b) => a - b);
        const counts = new Map(this.deps.countAtLeast(scores).map(c => [c.minScore, c.total]));
        const progress = this.deps.checkProgress();
        return {
            minScore,
            defaultMinScore: DEFAULT_MIN_SCORE,
            minAllowed: MIN_ALLOWED_SCORE,
            maxAllowed: MAX_ALLOWED_SCORE,
            choices: DOUBT_CHOICES.map(score => ({ score, total: counts.get(score) ?? 0 })),
            current: { total: counts.get(minScore) ?? 0 },
            people: this.deps.peopleAtLeast(minScore),
            checked: progress.scored + progress.failed,
            candidates: progress.candidates,
            changed: this.deps.countChanged(),
        };
    }

    list(offset: number, limit: number, personId: number | null = null): DoubtfulTile[] {
        const start = Math.max(0, Math.floor(offset) || 0);
        const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit) || 1));
        return this.deps.list(this.getMinScore(), personId, start, size);
    }

    // ---- actions -------------------------------------------------------------------------------------------------

    /** "Not a face": ignores the faces that are still doubtful; people who lost a face are rebuilt. The ids it changed come back for an exact Undo. */
    async ignore(ids: number[]): Promise<{ changedIds: number[] }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { changedIds: [] };
        return this.finish(this.deps.ignore(wanted, this.getMinScore(), this.deps.now()));
    }

    /** "Back to suggestions": takes the faces out of their person (kept as the suggestion); people who lost a face are rebuilt. */
    async unassign(ids: number[]): Promise<{ changedIds: number[] }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { changedIds: [] };
        return this.finish(this.deps.unassign(wanted, this.getMinScore(), this.deps.now()));
    }

    /** "These are real faces": they are not offered again. Nothing else changes. */
    async keep(ids: number[]): Promise<{ kept: number }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { kept: 0 };
        return { kept: this.deps.keep(wanted, this.getMinScore(), this.deps.now()) };
    }

    /** Gives changed faces back as they were; the people they return to are rebuilt. */
    async undo(ids: number[]): Promise<{ restoredIds: number[] }> {
        const wanted = cleanIds(ids);
        if (wanted.length === 0) return { restoredIds: [] };
        const restored = this.deps.undo(wanted);
        await this.rebuild(restored.map(item => item.personId));
        return { restoredIds: restored.map(item => item.faceId) };
    }

    private async finish(done: ChangedFace[]): Promise<{ changedIds: number[] }> {
        await this.rebuild(done.map(item => item.formerPersonId));
        return { changedIds: done.map(item => item.faceId) };
    }

    private async rebuild(personIds: (number | null)[]): Promise<void> {
        for (const personId of new Set(personIds.filter((id): id is number => id !== null))) {
            try {
                await this.deps.recalculate(personId);
            } catch (error) {
                logger.error(`[Doubtful] Could not rebuild the centroids of person ${personId}: ${String(error)}`);
            }
        }
    }
}

function isAllowedScore(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_ALLOWED_SCORE && value <= MAX_ALLOWED_SCORE;
}

/** Positive whole numbers only, each once. A list longer than one action may cover is refused, not cut. */
function cleanIds(ids: number[]): number[] {
    if (ids.length > MAX_IDS_PER_ACTION) throw new Error(`Too many faces in one action (the limit is ${MAX_IDS_PER_ACTION})`);
    return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
}
