/** Same shape the main process sends on `scan-progress` (electron/scanning/scanProgress.ts). */
export interface ScanProgress {
    phase: 'collecting' | 'processing';
    done: number;
    total: number;
    folder: string;
}

const MIN_FILES_FOR_ESTIMATE = 20;
const MIN_MS_FOR_ESTIMATE = 5000;

/** Time left at the speed so far, or null while too little has run for a fair guess. */
export function estimateRemainingMs(done: number, total: number, elapsedMs: number): number | null {
    if (done < MIN_FILES_FOR_ESTIMATE || elapsedMs < MIN_MS_FOR_ESTIMATE || total <= done) return null;
    return Math.round((total - done) * (elapsedMs / done));
}

export function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The last two folders of a path: enough to recognise where the scan is. */
function shortFolder(folder: string): string {
    return folder.split(/[\\/]/).filter(Boolean).slice(-2).join('\\');
}

/** 0 to 100 for a progress bar; 0 while the total is unknown. */
export function scanPercent(progress: ScanProgress | null): number {
    if (!progress || progress.total <= 0) return 0
    return Math.min(100, Math.round((progress.done / progress.total) * 100))
}

export function describeScanProgress(progress: ScanProgress, elapsedMs: number): string {
    if (progress.phase === 'collecting') return 'Looking for photos…';

    const parts = [`${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}`];
    if (progress.folder) parts.push(shortFolder(progress.folder));
    const remaining = estimateRemainingMs(progress.done, progress.total, elapsedMs);
    if (remaining !== null) parts.push(`about ${formatDuration(remaining)} left`);
    return parts.join(' · ');
}
