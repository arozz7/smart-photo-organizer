import { batchPaths } from './PathBatcher';
import type { SendTarget, TargetSendResult } from './SendTarget';
import type { SendToSettings } from './sendToSettings';

export const CLEARFRAME_TARGET_ID = 'clearframe';

export interface ClearFrameTargetDeps {
    /** Starts ClearFrame with these paths as its arguments (ClearFrame merges a second launch into its open window). */
    launch(executablePath: string, paths: string[]): Promise<void>;
    /** Where ClearFrame is installed, or null when it is not found. Used only when no path is configured. */
    probeInstalledPath(): string | null;
    /**
     * Resolves true once ClearFrame is ready for another launch. Called only between launches, so a
     * send that fits one launch never waits. ClearFrame can abort when a second launch arrives while the
     * first is still starting; this dependency can be made a no-op once ClearFrame has fixed that.
     */
    waitUntilReady(): Promise<boolean>;
}

/** Sends photos to ClearFrame by passing their paths on its command line. Copies nothing. */
export class ClearFrameTarget implements SendTarget {
    readonly id = CLEARFRAME_TARGET_ID;
    readonly label = 'ClearFrame';

    constructor(private readonly deps: ClearFrameTargetDeps) {}

    async send(paths: readonly string[], settings: SendToSettings): Promise<TargetSendResult> {
        const executablePath = settings.clearFrameExecutablePath ?? this.deps.probeInstalledPath();
        if (!executablePath) {
            return { ok: false, reason: 'not_configured', handedOver: 0, batches: 0 };
        }

        const { batches, oversized } = batchPaths(paths, { exePath: executablePath, maxCommandChars: settings.maxCommandChars });
        let handedOver = 0;

        for (const [index, batch] of batches.entries()) {
            // The order in which ClearFrame shows batches is not guaranteed, so none is promised.
            if (index > 0 && !(await this.deps.waitUntilReady())) {
                return { ok: false, reason: 'launch_failed', handedOver, batches: index };
            }
            try {
                await this.deps.launch(executablePath, batch);
            } catch {
                return { ok: false, reason: 'launch_failed', handedOver, batches: index };
            }
            handedOver += batch.length;
        }

        return oversized.length > 0
            ? { ok: true, handedOver, batches: batches.length, skippedTooLong: oversized.length }
            : { ok: true, handedOver, batches: batches.length };
    }
}
