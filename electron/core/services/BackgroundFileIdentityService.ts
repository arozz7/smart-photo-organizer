import { IService } from '../interfaces/IService';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PhotoIdentityRepository } from '../../data/repositories/PhotoIdentityRepository';
import { readFileIdentity } from '../../scanning/fileIdentity';
import logger from '../../logger';
import { FileIdentityBackfill } from './FileIdentityBackfill';

/**
 * Idle-time service that records file identity (size, modified time, file id) for photos indexed before it was
 * tracked. Runs once per app session after a startup delay, yields to scans and AI work, and stops on shutdown.
 */
export class BackgroundFileIdentityService implements IService {
    private readonly startupDelayMs = 20_000;
    private timer: NodeJS.Timeout | null = null;
    private backfill: FileIdentityBackfill | null = null;
    private running: Promise<void> | null = null;

    start(): void {
        if (this.timer || this.running) return;
        logger.info(`[BackgroundFileIdentityService] Starting in ${this.startupDelayMs}ms...`);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.running = this.runOnce().finally(() => { this.running = null; });
        }, this.startupDelayMs);
    }

    async stop(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.backfill?.stop();
        await this.running;
    }

    private async runOnce(): Promise<void> {
        try {
            const pending = PhotoIdentityRepository.countPhotosNeedingIdentity();
            if (pending === 0) {
                logger.info('[BackgroundFileIdentityService] Nothing to backfill.');
                return;
            }

            logger.info(`[BackgroundFileIdentityService] Recording file identity for ${pending} photos...`);
            this.backfill = new FileIdentityBackfill({
                repository: PhotoIdentityRepository,
                readIdentity: readFileIdentity,
                isBusy: () => AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive(),
                shouldAbort: () => AppStateRepository.isShutdownRequested(),
                sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            });

            const { updated, unreadable } = await this.backfill.run();
            logger.info(`[BackgroundFileIdentityService] Done: ${updated} recorded, ${unreadable} unreadable (left as they are).`);
        } catch (error) {
            logger.error('[BackgroundFileIdentityService] Backfill failed:', error);
        } finally {
            this.backfill = null;
        }
    }
}
