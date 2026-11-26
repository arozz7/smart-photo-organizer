import { IService } from '../interfaces/IService';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { CaptionRepository } from '../../data/repositories/CaptionRepository';
import { getAISettings } from '../../store';
import logger from '../../logger';
import { BackgroundLoop } from './BackgroundLoop';
import { CaptionBackfill, type CaptionStepResult } from './CaptionBackfill';
import { captionsRunInBackground } from './captionTiming';
import { PhotoService } from './PhotoService';

const STARTUP_DELAY_MS = 60_000;

/**
 * Describes and tags photos after their faces were scanned, when nothing else is working (the "Smart Tags in the
 * background" setting). Keeps the face scan at its own speed: captioning takes about four times as long as finding faces.
 */
export class BackgroundCaptionService implements IService {
    private lastResult: CaptionStepResult = 'busy';
    private loggedBacklog = false;
    private readonly backfill = new CaptionBackfill({
        fetchBatch: (skip, limit) => CaptionRepository.getPhotosNeedingCaption(skip, limit).map(photo => ({ id: photo.id, filePath: photo.file_path })),
        caption: async photo => {
            const result = await PhotoService.generateTags(photo.id, photo.filePath);
            return Boolean(result && !result.error && (result.description || result.tags?.length));
        },
        isBusy: () => AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive(),
        isEnabled: () => captionsRunInBackground(getAISettings()),
        shouldAbort: () => AppStateRepository.isShutdownRequested(),
        now: () => Date.now(),
    });
    private readonly loop = new BackgroundLoop(
        () => this.tick(),
        () => this.backfill.delayMsAfter(this.lastResult),
        STARTUP_DELAY_MS,
    );

    start(): void {
        logger.info('[BackgroundCaptionService] Started.');
        this.loop.start();
    }

    async stop(): Promise<void> {
        await this.loop.stop();
    }

    private async tick(): Promise<void> {
        try {
            this.lastResult = await this.backfill.step();
            if (!this.loggedBacklog && this.lastResult === 'captioned') {
                this.loggedBacklog = true;
                logger.info(`[BackgroundCaptionService] Captioning in the background: ${CaptionRepository.countPhotosNeedingCaption()} photos waiting.`);
            }
        } catch (error) {
            logger.error('[BackgroundCaptionService] Step failed:', error);
            this.lastResult = 'failed';
        }
    }
}
