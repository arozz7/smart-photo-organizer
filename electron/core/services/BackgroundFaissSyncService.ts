import { IService } from '../interfaces/IService';
import logger from '../../logger';
import { decideFaissSync, formatNamedFaceFingerprint, type NamedFaceFingerprint } from './faissSync';

/** Everything the service needs from the outside, so it can be tested without a database or the AI backend. */
export interface FaissSyncDeps {
    getNamedFaceFingerprint(): NamedFaceFingerprint;
    /** Vectors in the index, or null if the AI backend did not answer. */
    getIndexVectorCount(): Promise<number | null>;
    /** Rebuilds the index from the named faces; true on success. */
    rebuildIndex(): Promise<boolean>;
    /** A scan or AI processing is running. */
    isBusy(): boolean;
    isShutdownRequested(): boolean;
    getSyncedFingerprint(): string | null;
    setSyncedFingerprint(value: string): void;
    now(): number;
}

/**
 * Keeps the face search index in step with the faces that belong to named people.
 *
 * Before this service the index was only filled by a manual "Rebuild Face Index", so a library where people had been
 * named since the last rebuild searched an empty or outdated index and found nothing. Every minute (when idle) it
 * compares the named faces with the index and rebuilds after a quiet check when they differ. See faissSync.ts.
 */
export class BackgroundFaissSyncService implements IService {
    private readonly startupDelayMs = 45_000;
    private readonly checkIntervalMs = 60_000;
    private readonly failedRebuildRetryMs = 10 * 60_000;

    private timer: NodeJS.Timeout | null = null;
    private running: Promise<void> | null = null;
    private stopped = true;
    private previousFingerprint: string | null = null;
    private retryNotBeforeMs = 0;

    constructor(private readonly deps: FaissSyncDeps) {}

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        logger.info(`[BackgroundFaissSyncService] Starting in ${this.startupDelayMs}ms...`);
        this.scheduleNextCheck(this.startupDelayMs);
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.running;
    }

    private scheduleNextCheck(delayMs: number): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.running = this.checkOnce()
                .catch(error => logger.error('[BackgroundFaissSyncService] Check failed:', error))
                .finally(() => {
                    this.running = null;
                    this.scheduleNextCheck(this.checkIntervalMs);
                });
        }, delayMs);
    }

    /** One look at the index. Public so tests can run a check without timers. */
    async checkOnce(): Promise<void> {
        if (this.deps.isShutdownRequested()) return;

        const named = this.deps.getNamedFaceFingerprint();
        const fingerprint = formatNamedFaceFingerprint(named);
        const indexCount = this.deps.isBusy() ? null : await this.deps.getIndexVectorCount();

        const decision = decideFaissSync({
            namedCount: named.count,
            fingerprint,
            previousFingerprint: this.previousFingerprint,
            syncedFingerprint: this.deps.getSyncedFingerprint(),
            indexCount,
            busy: this.deps.isBusy(),
            nowMs: this.deps.now(),
            retryNotBeforeMs: this.retryNotBeforeMs,
        });
        this.previousFingerprint = fingerprint;

        if (decision === 'record-in-sync') {
            this.deps.setSyncedFingerprint(fingerprint);
            return;
        }
        if (decision !== 'rebuild') return;

        logger.info(`[BackgroundFaissSyncService] Index holds ${indexCount} vectors but ${named.count} faces are named; rebuilding.`);
        let ok = false;
        try {
            ok = await this.deps.rebuildIndex();
        } catch (error) {
            logger.error('[BackgroundFaissSyncService] Rebuild threw:', error);
        }
        if (ok) {
            this.deps.setSyncedFingerprint(fingerprint);
            logger.info('[BackgroundFaissSyncService] Index rebuilt.');
        } else {
            this.retryNotBeforeMs = this.deps.now() + this.failedRebuildRetryMs;
            logger.warn('[BackgroundFaissSyncService] Rebuild failed; will retry later.');
        }
    }
}
