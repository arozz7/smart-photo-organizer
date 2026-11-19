import logger from '../../logger';
import type { IService } from '../interfaces/IService';

/** Length of a face descriptor (InsightFace embedding). */
const DESCRIPTOR_DIM = 512;

const STATE_KEY = 'rematch_state';
const LAST_RUN_KEY = 'rematch_last';
const AUTO_KEY = 'rematch_auto';
const DISTANCE_KEY = 'rematch_distance';

/**
 * How close (L2 between unit descriptors) a face must be to a named person to be matched. 0.65 was measured on the
 * real library: no face the user ignored lies within 0.8 of a named person, and 0.65 keeps the review list manageable.
 * Its own setting, not the Face Similarity Threshold (which also steers scan-time matching and may be far looser).
 */
export const DEFAULT_DISTANCE = 0.65;
export const MIN_DISTANCE = 0.4;
/** The distance at which the background grouping already suggests a person. */
export const MAX_DISTANCE = 0.8;

export interface RematchFace {
    id: number;
    /** Raw float32 descriptor bytes as stored in the database. */
    descriptor: Buffer;
}

export interface RematchMatch {
    faceId: number;
    personId: number;
    distance: number;
}

/** Everything the service needs from outside, so it can be tested without a database. */
export interface RematchDeps {
    /** Named people with their centroids (what FaceService.matchAgainstCentroids compares with). */
    loadPeople(): object[];
    /** Changes whenever a named person's centroids change. */
    centroidFingerprint(): string;
    /** The nearest named person within `threshold`, or null. */
    match(descriptor: number[], people: object[], threshold: number): { personId: number; distance: number } | null;
    countUnassigned(): number;
    loadFaces(afterId: number, limit: number): RematchFace[];
    /** "faceId:personId" pairs among these faces that were re-matched before (and so are not offered again). */
    findTriedPairs(faceIds: number[]): Set<string>;
    saveMatches(matches: RematchMatch[]): void;
    undoUnconfirmed(): number;
    countUndoable(): number;
    /** A scan or AI work is running, or the app is shutting down. */
    isBusy(): boolean;
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string): void;
    now(): number;
}

export interface RematchOptions {
    /** Faces matched per step. */
    batchSize?: number;
    /** Least time between two automatic runs. */
    minIntervalMs?: number;
    /** How often the background loop looks for work. */
    checkIntervalMs?: number;
    /** Pause between steps of a run, so other work gets the processor. */
    stepPauseMs?: number;
    startupDelayMs?: number;
}

interface RunState {
    lastFaceId: number;
    checked: number;
    matched: number;
    total: number;
    /** The people (centroids) and distance this run started with. */
    fingerprint: string;
    threshold: number;
    startedAt: string;
}

interface LastRun {
    completedAt: string;
    fingerprint: string;
    threshold: number;
    matched: number;
    checked: number;
    error?: string;
}

export interface RematchStatus {
    running: boolean;
    autoEnabled: boolean;
    /** The distance in use (the run's own while running). */
    threshold: number;
    checked: number;
    total: number;
    matched: number;
    /** Re-matched faces still unconfirmed, which "Undo re-match" would return. */
    undoable: number;
    lastRun: LastRun | null;
}

export type RematchStartResult = { started: true } | { started: false; reason: 'busy' | 'already-running' | 'nobody-named' };

function parseJson<T>(raw: string | null): T | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function toDescriptor(buffer: Buffer): number[] | null {
    if (buffer.byteLength !== DESCRIPTOR_DIM * 4) return null;
    // copy first: a database buffer may not be aligned for a Float32Array view
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return Array.from(new Float32Array(bytes));
}

/**
 * Matches unassigned faces against the people the user has named, long after the faces were first processed
 * (docs/plans/review-queue-parking-plan.md, Phase 2). Matches are assigned unconfirmed, so they show up on the person's
 * page for review, and every match is logged so a rejected one is not made again.
 *
 * A run is a series of small steps (one page of faces each) that only happen while no scan or AI work is running.
 * Progress is stored, so a run resumes after a restart. It starts by itself when nobody ran it yet, or when the named
 * people or the distance setting changed since the last run (and not more often than `minIntervalMs`), unless switched off.
 */
export class RematchService implements IService {
    private readonly batchSize: number;
    private readonly minIntervalMs: number;
    private readonly checkIntervalMs: number;
    private readonly stepPauseMs: number;
    private readonly startupDelayMs: number;

    /** The people of the current run, loaded once per run. */
    private people: object[] | null = null;
    private stopped = true;
    private loopDone: Promise<void> | null = null;
    private wake: (() => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly deps: RematchDeps, options: RematchOptions = {}) {
        this.batchSize = options.batchSize ?? 300;
        this.minIntervalMs = options.minIntervalMs ?? 30 * 60_000;
        this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
        this.stepPauseMs = options.stepPauseMs ?? 1_000;
        this.startupDelayMs = options.startupDelayMs ?? 30_000;
    }

    // ---- control -----------------------------------------------------------------------------------------------

    getStatus(): RematchStatus {
        const state = this.readState();
        const last = this.readLastRun();
        return {
            running: state !== null,
            autoEnabled: this.isAutoEnabled(),
            threshold: state?.threshold ?? this.getDistance(),
            checked: state?.checked ?? 0,
            total: state?.total ?? 0,
            matched: state?.matched ?? 0,
            undoable: this.deps.countUndoable(),
            lastRun: last,
        };
    }

    /** Starts a run now (the "Run now" button). The steps happen on the next ticks of the background loop. */
    startRun(): RematchStartResult {
        if (this.readState()) return { started: false, reason: 'already-running' };
        if (this.deps.isBusy()) return { started: false, reason: 'busy' };
        if (this.deps.loadPeople().length === 0) return { started: false, reason: 'nobody-named' };
        this.begin();
        this.wakeLoop();
        return { started: true };
    }

    setAutoEnabled(enabled: boolean): void {
        this.deps.writeFlag(AUTO_KEY, enabled ? '1' : '0');
    }

    /**
     * Chooses how close a face must be to a named person to be matched. Returns false (and changes nothing) outside
     * MIN_DISTANCE to MAX_DISTANCE. A run in progress keeps the distance it started with.
     */
    setDistance(distance: number): boolean {
        if (!Number.isFinite(distance) || distance < MIN_DISTANCE || distance > MAX_DISTANCE) return false;
        this.deps.writeFlag(DISTANCE_KEY, String(distance));
        return true;
    }

    private getDistance(): number {
        const stored = Number(this.deps.readFlag(DISTANCE_KEY));
        const valid = this.deps.readFlag(DISTANCE_KEY) !== null && Number.isFinite(stored) && stored >= MIN_DISTANCE && stored <= MAX_DISTANCE;
        return valid ? stored : DEFAULT_DISTANCE;
    }

    /**
     * Returns the unconfirmed re-matched faces to unassigned (refused, 0, while a run is under way). Undoing means the
     * user does not trust the matches, so the automatic runs are switched off too; "Run now" or the switch bring them back.
     */
    undo(): number {
        if (this.readState()) return 0;
        const undone = this.deps.undoUnconfirmed();
        if (undone > 0) this.setAutoEnabled(false);
        logger.info(`[Rematch] Undo: ${undone} unconfirmed re-matched faces returned to unassigned`);
        return undone;
    }

    // ---- one step ----------------------------------------------------------------------------------------------

    /** One scheduling step: starts an automatic run if one is due, then matches one page of faces. Never throws. */
    async tick(): Promise<void> {
        let state: RunState | null = null;
        try {
            if (this.deps.isBusy()) return;
            state = this.readState();
            if (!state) {
                if (!this.isAutomaticRunDue()) return;
                state = this.begin();
            }
            this.step(state);
        } catch (error) {
            this.fail(state, error);
        }
    }

    private step(state: RunState): void {
        const people = this.people ?? (this.people = this.deps.loadPeople());
        const faces = people.length > 0 ? this.deps.loadFaces(state.lastFaceId, this.batchSize) : [];
        if (faces.length === 0) {
            this.finish(state);
            return;
        }

        const tried = this.deps.findTriedPairs(faces.map(face => face.id));
        const matches: RematchMatch[] = [];
        for (const face of faces) {
            const descriptor = toDescriptor(face.descriptor);
            if (!descriptor) continue;
            const found = this.deps.match(descriptor, people, state.threshold);
            if (found && !tried.has(`${face.id}:${found.personId}`)) {
                matches.push({ faceId: face.id, personId: found.personId, distance: found.distance });
            }
        }
        if (matches.length > 0) this.deps.saveMatches(matches);

        this.writeState({
            ...state,
            lastFaceId: faces[faces.length - 1].id,
            checked: state.checked + faces.length,
            matched: state.matched + matches.length,
        });
    }

    // ---- starting, finishing, failing ----------------------------------------------------------------------------

    private begin(): RunState {
        const state: RunState = {
            lastFaceId: 0,
            checked: 0,
            matched: 0,
            total: this.deps.countUnassigned(),
            fingerprint: this.deps.centroidFingerprint(),
            threshold: this.getDistance(),
            startedAt: new Date(this.deps.now()).toISOString(),
        };
        this.people = null;
        this.writeState(state);
        logger.info(`[Rematch] Started: ${state.total} unassigned faces, distance ${state.threshold}`);
        return state;
    }

    private finish(state: RunState): void {
        this.record(state, undefined);
        logger.info(`[Rematch] Finished: ${state.matched} of ${state.checked} unassigned faces matched a named person (distance ${state.threshold})`);
    }

    private fail(state: RunState | null, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[Rematch] Stopped by an error: ${message}`);
        try {
            this.record(state, message);
        } catch (recordError) {
            logger.error(`[Rematch] Could not record the error: ${String(recordError)}`);
        }
    }

    /** Ends the run and remembers what it was done with, so the same people and distance are not run again at once. */
    private record(state: RunState | null, error: string | undefined): void {
        const last: LastRun = {
            completedAt: new Date(this.deps.now()).toISOString(),
            fingerprint: state?.fingerprint ?? this.deps.centroidFingerprint(),
            threshold: state?.threshold ?? this.getDistance(),
            matched: state?.matched ?? 0,
            checked: state?.checked ?? 0,
            ...(error ? { error } : {}),
        };
        this.deps.writeFlag(LAST_RUN_KEY, JSON.stringify(last));
        this.deps.writeFlag(STATE_KEY, '');
        this.people = null;
    }

    private isAutomaticRunDue(): boolean {
        if (!this.isAutoEnabled()) return false;
        if (this.deps.loadPeople().length === 0) return false;
        const last = this.readLastRun();
        if (!last) return true;
        if (last.fingerprint === this.deps.centroidFingerprint() && last.threshold === this.getDistance()) return false;
        return this.deps.now() - Date.parse(last.completedAt) >= this.minIntervalMs;
    }

    // ---- stored state ------------------------------------------------------------------------------------------

    private readState(): RunState | null {
        return parseJson<RunState>(this.deps.readFlag(STATE_KEY));
    }

    private writeState(state: RunState): void {
        this.deps.writeFlag(STATE_KEY, JSON.stringify(state));
    }

    private readLastRun(): LastRun | null {
        return parseJson<LastRun>(this.deps.readFlag(LAST_RUN_KEY));
    }

    private isAutoEnabled(): boolean {
        return this.deps.readFlag(AUTO_KEY) !== '0';
    }

    // ---- background loop ---------------------------------------------------------------------------------------

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.loopDone = this.loop();
        logger.info('[Rematch] Started.');
    }

    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        this.wakeLoop();
        await this.loopDone;
        logger.info('[Rematch] Stopped.');
    }

    private async loop(): Promise<void> {
        await this.pause(this.startupDelayMs);
        while (!this.stopped) {
            await this.tick();
            await this.pause(this.readState() ? this.stepPauseMs : this.checkIntervalMs);
        }
    }

    private pause(ms: number): Promise<void> {
        return new Promise<void>(resolve => {
            this.wake = resolve;
            this.timer = setTimeout(resolve, ms);
        }).then(() => {
            if (this.timer) clearTimeout(this.timer);
            this.timer = null;
            this.wake = null;
        });
    }

    private wakeLoop(): void {
        this.wake?.();
    }
}
