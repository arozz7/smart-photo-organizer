import type { SendToSettings } from './sendToSettings';

export type TargetFailureReason = 'not_configured' | 'launch_failed';

export type TargetSendResult =
    | {
        ok: true;
        /** Files passed to the program. SPO cannot see whether the program accepted each one. */
        handedOver: number;
        /** Times the program was started. */
        batches: number;
        /** Paths too long for any command line. Present only when there were some. */
        skippedTooLong?: number;
    }
    | { ok: false; reason: TargetFailureReason; handedOver: number; batches: number };

/**
 * A program that photos can be sent to. Implementations only pass existing file paths on: they must
 * never copy a photo, stage it in a folder or write metadata (decisions L-001, L-026, L-031).
 * A new target (for example another editor that reads a list file) is added by implementing this and
 * registering it; nothing else changes.
 */
export interface SendTarget {
    readonly id: string;
    readonly label: string;
    send(paths: readonly string[], settings: SendToSettings): Promise<TargetSendResult>;
}
