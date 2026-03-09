import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { ContextualMatchingService } from './ContextualMatchingService';
import { IService } from '../interfaces/IService';
import logger from '../../logger';

/**
 * BackgroundPropagationService
 *
 * Runs contextual label propagation (temporal + spatial) in the background
 * when the app is idle — no active scan, no AI queue.
 *
 * Lifecycle:
 *  - Starts after a short delay (lets UI settle).
 *  - Runs one full library-wide propagation pass, then sleeps.
 *  - Re-runs every RERUN_INTERVAL_MS to pick up newly confirmed faces.
 *  - Pauses completely when a scan or AI job is active.
 */
export class BackgroundPropagationService implements IService {
    private isRunning = false;
    private shouldStop = false;
    private stopPromise: Promise<void> | null = null;
    private resolveStop: (() => void) | null = null;

    private readonly startupDelayMs = 30_000;   // 30 s after app start
    private readonly idleCheckMs = 10_000;      // poll interval when idle
    private readonly rerunIntervalMs = 3_600_000; // re-run once per hour

    private lastRunAt = 0;

    private yield(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            const check = () => {
                if (this.shouldStop) { resolve(); return; }
                resolve();
            };
            setTimeout(check, ms);
        });
    }

    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.shouldStop = false;

        this.stopPromise = new Promise(resolve => { this.resolveStop = resolve; });

        logger.info(`[BackgroundPropagationService] Delaying startup by ${this.startupDelayMs}ms...`);
        setTimeout(() => {
            if (!this.shouldStop) this.loop();
        }, this.startupDelayMs);

        logger.info('[BackgroundPropagationService] Started.');
    }

    async stop(): Promise<void> {
        if (!this.isRunning) return;
        this.shouldStop = true;
        logger.info('[BackgroundPropagationService] Stop requested.');
        if (this.stopPromise) return this.stopPromise;
    }

    private async loop(): Promise<void> {
        while (!this.shouldStop) {
            try {
                if (AppStateRepository.isShutdownRequested()) break;

                // Yield when a scan or AI queue is active
                if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                    await this.sleep(this.idleCheckMs);
                    continue;
                }

                const now = Date.now();
                if (now - this.lastRunAt < this.rerunIntervalMs) {
                    await this.sleep(this.idleCheckMs);
                    continue;
                }

                logger.info('[BackgroundPropagationService] Running contextual propagation pass...');
                await this.yield();

                const result = ContextualMatchingService.batchPropagateForLibrary();
                this.lastRunAt = Date.now();

                logger.info(
                    { propagated: result.propagated, skipped: result.skipped },
                    '[BackgroundPropagationService] Pass complete.'
                );
            } catch (err) {
                logger.error({ err }, '[BackgroundPropagationService] Loop error');
            }

            await this.sleep(this.idleCheckMs);
        }

        this.isRunning = false;
        if (this.resolveStop) this.resolveStop();
        logger.info('[BackgroundPropagationService] Stopped.');
    }
}
