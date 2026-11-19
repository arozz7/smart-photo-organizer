import logger from '../../logger';
import type { IService } from '../interfaces/IService';
import { BackgroundLoop } from './BackgroundLoop';

const MODE_KEY = 'visibility_mode';
const AWAY_KEY = 'visibility_away_minutes';

/** When the scoring may run: never, only while the user is away, or whenever no scan or AI work is running. */
export const RUN_MODES = ['off', 'away', 'always'] as const;
export type RunMode = (typeof RUN_MODES)[number];
export const DEFAULT_MODE: RunMode = 'away';
/** "Away" means no keyboard or mouse input for this long. */
export const DEFAULT_AWAY_MINUTES = 5;
export const MIN_AWAY_MINUTES = 1;
export const MAX_AWAY_MINUTES = 60;

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_BACKOFF_MS = 30 * 60_000;
const STEP_PAUSE_MS = 1_000;
const WAIT_MS = 30_000;
const STARTUP_DELAY_MS = 60_000;

/** One face for the vision model: a box on an image (a preview or the photo) and the width of the original photo the box was measured on. */
export interface VisibilityFace {
    id: number;
    imagePath: string;
    photoWidth: number | null;
    box: { x: number; y: number; width: number; height: number };
}

/** The model's answer for one face: higher means "no clear face visible". `score` is null when that face could not be scored. */
export interface VisibilityResult {
    faceId: number;
    score: number | null;
    error?: string;
}

export interface VisibilityCounts {
    /** Faces that need a look from the model (uncertain detector score, in the review queue). */
    candidates: number;
    scored: number;
    failed: number;
}

/** Everything the service needs from outside, so it can be tested without a database, a GPU or a clock. */
export interface FaceVisibilityDeps {
    counts(): VisibilityCounts;
    /** The next faces without a score, the most uncertain first. */
    loadDue(limit: number): VisibilityFace[];
    /** Asks the model about these faces. Throws when the whole call fails (engine down, no GPU, timeout). */
    score(faces: VisibilityFace[]): Promise<VisibilityResult[]>;
    save(results: VisibilityResult[]): void;
    /** A scan or AI work is running, or the app is shutting down. */
    isBusy(): boolean;
    /** Seconds since the last keyboard or mouse input. */
    idleSeconds(): number;
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string): void;
    now(): number;
}

export interface FaceVisibilityOptions {
    batchSize?: number;
    /** How long to leave the model alone after a whole call failed. */
    backoffMs?: number;
}

export type VisibilityState = 'off' | 'done' | 'error' | 'waiting-busy' | 'waiting-away' | 'scoring' | 'ready';

export interface VisibilityStatus {
    mode: RunMode;
    awayMinutes: number;
    state: VisibilityState;
    candidates: number;
    scored: number;
    failed: number;
    remaining: number;
    lastError: string | null;
}

export type RunNowResult = { started: true } | { started: false; reason: 'busy' | 'nothing-to-do' };

/**
 * Asks the vision model "is a clear face visible?" about every uncertain face in the review queue, a few at a time and
 * only when nothing else needs the machine (docs/plans/non-face-and-picture-faces-plan.md, Phase B part 2 and Phase D).
 *
 * - A scan or AI work always wins; in "away" mode (the default) it also waits for the user to stop using the computer,
 *   and pauses again as soon as input returns (a batch is a few seconds, so the pause happens at the next batch).
 * - Progress is the database itself (a face with a score is done), so it resumes after a restart and never repeats a face.
 * - A face that cannot be scored is recorded as failed and not retried. A whole call that fails (no GPU, engine down,
 *   timeout) leaves the faces alone and backs off for half an hour; "Run now" ends the back-off.
 */
export class FaceVisibilityService implements IService {
    private readonly batchSize: number;
    private readonly backoffMs: number;
    private readonly loop: BackgroundLoop;

    private inFlight = false;
    /** "Run now": ignores the mode and the idle time until everything is scored. Not stored: a restart goes back to the mode. */
    private manual = false;
    private retryAfter = 0;
    private lastError: string | null = null;

    constructor(private readonly deps: FaceVisibilityDeps, options: FaceVisibilityOptions = {}) {
        this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
        this.loop = new BackgroundLoop(() => this.tick(), () => (this.hasWork() ? STEP_PAUSE_MS : WAIT_MS), STARTUP_DELAY_MS);
    }

    // ---- settings ------------------------------------------------------------------------------------------------

    private mode(): RunMode {
        const stored = this.deps.readFlag(MODE_KEY);
        return (RUN_MODES as readonly string[]).includes(stored ?? '') ? (stored as RunMode) : DEFAULT_MODE;
    }

    private awayMinutes(): number {
        const stored = Number(this.deps.readFlag(AWAY_KEY));
        return Number.isInteger(stored) && stored >= MIN_AWAY_MINUTES && stored <= MAX_AWAY_MINUTES ? stored : DEFAULT_AWAY_MINUTES;
    }

    /** Returns false (and changes nothing) for a mode that does not exist. */
    setMode(mode: string): boolean {
        if (!(RUN_MODES as readonly string[]).includes(mode)) return false;
        this.deps.writeFlag(MODE_KEY, mode);
        this.loop.wake();
        return true;
    }

    /** Returns false (and changes nothing) for a value that is not a whole number of minutes from 1 to 60. */
    setAwayMinutes(minutes: number): boolean {
        if (!Number.isInteger(minutes) || minutes < MIN_AWAY_MINUTES || minutes > MAX_AWAY_MINUTES) return false;
        this.deps.writeFlag(AWAY_KEY, String(minutes));
        return true;
    }

    // ---- status and control --------------------------------------------------------------------------------------

    getStatus(): VisibilityStatus {
        const { candidates, scored, failed } = this.deps.counts();
        const remaining = Math.max(0, candidates - scored - failed);
        return { mode: this.mode(), awayMinutes: this.awayMinutes(), state: this.state(remaining), candidates, scored, failed, remaining, lastError: this.lastError };
    }

    private state(remaining: number): VisibilityState {
        if (this.isBackingOff()) return 'error';
        if (this.mode() === 'off' && !this.manual) return 'off';
        if (remaining === 0) return 'done';
        if (this.deps.isBusy()) return 'waiting-busy';
        if (this.waitingForAway()) return 'waiting-away';
        return this.inFlight ? 'scoring' : 'ready';
    }

    /** Starts now whatever the mode and idle time say (the "Run now" button); still never while a scan or AI work is running. */
    runNow(): RunNowResult {
        if (this.deps.isBusy()) return { started: false, reason: 'busy' };
        if (this.deps.loadDue(1).length === 0) return { started: false, reason: 'nothing-to-do' };
        this.manual = true;
        this.retryAfter = 0;
        this.loop.wake();
        return { started: true };
    }

    private isBackingOff(): boolean {
        return this.retryAfter > this.deps.now();
    }

    private waitingForAway(): boolean {
        return !this.manual && this.mode() === 'away' && this.deps.idleSeconds() < this.awayMinutes() * 60;
    }

    private hasWork(): boolean {
        return this.inFlight || this.manual || (this.mode() !== 'off' && !this.isBackingOff());
    }

    // ---- one step ------------------------------------------------------------------------------------------------

    /** Scores one batch if it is allowed to now. Never throws. */
    async tick(): Promise<void> {
        if (this.inFlight) return;
        try {
            if (this.mode() === 'off' && !this.manual) return;
            if (this.deps.isBusy() || this.waitingForAway() || this.isBackingOff()) return;
            const due = this.deps.loadDue(this.batchSize);
            if (due.length === 0) {
                this.manual = false;
                return;
            }
            this.inFlight = true;
            const results = await this.deps.score(due);
            this.deps.save(onePerFace(due, results));
            this.lastError = null;
        } catch (error) {
            this.fail(error);
        } finally {
            this.inFlight = false;
        }
    }

    private fail(error: unknown): void {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.retryAfter = this.deps.now() + this.backoffMs;
        logger.error(`[FaceVisibility] Paused after an error: ${this.lastError}`);
    }

    // ---- background loop -----------------------------------------------------------------------------------------

    start(): void {
        this.loop.start();
        logger.info('[FaceVisibility] Started.');
    }

    async stop(): Promise<void> {
        await this.loop.stop();
        logger.info('[FaceVisibility] Stopped.');
    }
}

/** Exactly one result per face asked about: a face the model did not answer for is recorded as failed, so a step always makes progress. */
function onePerFace(asked: VisibilityFace[], results: VisibilityResult[]): VisibilityResult[] {
    const byFace = new Map(results.map(result => [result.faceId, result]));
    return asked.map(face => {
        const result = byFace.get(face.id);
        if (!result) return { faceId: face.id, score: null, error: 'No answer from the model' };
        return { faceId: face.id, score: typeof result.score === 'number' && Number.isFinite(result.score) ? result.score : null, ...(result.error ? { error: result.error } : {}) };
    });
}
