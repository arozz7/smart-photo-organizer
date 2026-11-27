import { QuietGate } from './QuietGate';

export interface CaptionCandidate {
    id: number;
    filePath: string;
}

/** What the backfill needs from outside, so it can be tested without a database, the engine or a clock. */
export interface CaptionBackfillDeps {
    /** The next photos that were face-scanned but have no description yet, newest first, leaving out `skip`. */
    fetchBatch(skip: ReadonlySet<number>, limit: number): CaptionCandidate[];
    /** Describes and tags one photo. Returns false when nothing could be stored. */
    caption(photo: CaptionCandidate): Promise<boolean>;
    /** A scan or face analysis is running: captions wait, so faces always go first. */
    isBusy(): boolean;
    /** Captions are set to run in the background. */
    isEnabled(): boolean;
    shouldAbort(): boolean;
    now(): number;
}

export type CaptionStepResult = 'captioned' | 'failed' | 'busy' | 'disabled' | 'done';

const BATCH_SIZE = 50;
const FAILURES_BEFORE_LONG_PAUSE = 5;
/** The "busy" flag drops for a moment between two photos of a scan; captions start only after this long without work. */
const QUIET_BEFORE_START_MS = 10_000;

const DELAY_MS = {
    captioned: 500,
    busy: 5_000,
    disabled: 60_000,
    done: 5 * 60_000,
    failed: 2_000,
    /** Several failures in a row: the engine is probably down; do not burn through the backlog marking it all as failed. */
    failedRepeatedly: 10 * 60_000,
} as const;

/**
 * Writes the photo descriptions and tags in the background, one photo per step, only while nothing else is working.
 * Captioning is slow (a few seconds a photo) and nothing needs it to finish before the faces are usable, so it runs
 * after the face scan instead of inside it. A photo that fails is not offered again until the next start of the app.
 */
export class CaptionBackfill {
    private buffer: CaptionCandidate[] = [];
    private readonly failed = new Set<number>();
    private consecutiveFailures = 0;
    private readonly gate: QuietGate;

    constructor(
        private readonly deps: CaptionBackfillDeps,
        private readonly batchSize: number = BATCH_SIZE,
        quietMs: number = QUIET_BEFORE_START_MS,
    ) {
        this.gate = new QuietGate(quietMs, () => deps.now());
    }

    async step(): Promise<CaptionStepResult> {
        if (!this.gate.isQuiet(this.deps.shouldAbort() || this.deps.isBusy())) return 'busy';
        if (!this.deps.isEnabled()) return 'disabled';

        const photo = this.nextPhoto();
        if (!photo) return 'done';

        const stored = await this.captionSafely(photo);
        if (stored) {
            this.consecutiveFailures = 0;
            return 'captioned';
        }
        this.failed.add(photo.id);
        this.consecutiveFailures++;
        return 'failed';
    }

    /** How long to wait before the next step. */
    delayMsAfter(result: CaptionStepResult): number {
        if (result === 'failed') {
            return this.consecutiveFailures >= FAILURES_BEFORE_LONG_PAUSE ? DELAY_MS.failedRepeatedly : DELAY_MS.failed;
        }
        return DELAY_MS[result];
    }

    private nextPhoto(): CaptionCandidate | undefined {
        if (this.buffer.length === 0) this.buffer = this.deps.fetchBatch(this.failed, this.batchSize);
        return this.buffer.shift();
    }

    private async captionSafely(photo: CaptionCandidate): Promise<boolean> {
        try {
            return await this.deps.caption(photo);
        } catch {
            return false;
        }
    }
}
