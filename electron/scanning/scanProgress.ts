import path from 'node:path';

/** What the screen is told while a scan runs. `total` is known once the file list has been collected. */
export interface ScanProgress {
    phase: 'collecting' | 'processing';
    done: number;
    total: number;
    /** Folder of the file that finished last. */
    folder: string;
}

export interface ProgressReporter {
    /** A file finished (stored, skipped or failed). Sends an update at most once per interval. */
    advance(file: string): void;
    /** Sends the final state, whatever the interval. */
    finish(): void;
}

const DEFAULT_INTERVAL_MS = 250;

/** Counts finished files against a known total and sends throttled updates (a few per second, not one per file). */
export function createProgressReporter(
    total: number,
    emit: (progress: ScanProgress) => void,
    now: () => number = Date.now,
    minIntervalMs: number = DEFAULT_INTERVAL_MS,
): ProgressReporter {
    let done = 0;
    let folder = '';
    let lastSent: number | null = null;

    const send = (): void => {
        lastSent = now();
        emit({ phase: 'processing', done, total, folder });
    };

    return {
        advance(file: string) {
            done++;
            folder = path.dirname(file);
            if (lastSent === null || now() - lastSent >= minIntervalMs) send();
        },
        finish: send,
    };
}
