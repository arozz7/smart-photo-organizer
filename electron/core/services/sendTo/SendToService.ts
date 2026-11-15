import type { PhotoPathRow, PhotoPathSource } from './PhotoPathSource';
import type { SendTarget, TargetFailureReason } from './SendTarget';
import type { SendToSettings } from './sendToSettings';

export type SendSource =
    | { kind: 'photos'; ids: readonly number[] }
    | { kind: 'smartAlbum'; albumId: number };

export interface SendRequest {
    targetId: string;
    source: SendSource;
    /** True once the user has agreed to a send larger than the confirm threshold. */
    confirmed?: boolean;
}

export interface SendCounts {
    /** Photos the user asked to send. */
    requested: number;
    /** Photos skipped because they are marked missing or their file is gone. */
    missing: number;
    /** Photos handed to the program. */
    sent: number;
    /** Photos whose path was too long for any command line. Present only when there were some. */
    tooLong?: number;
}

/** `invalid_request` is produced by the IPC layer when the payload fails validation. */
export type SendFailureReason = TargetFailureReason | 'unknown_target' | 'unknown_source' | 'nothing_to_send' | 'invalid_request';

export type SendOutcome =
    | { status: 'sent'; counts: SendCounts; batches: number }
    | { status: 'needs_confirmation'; counts: SendCounts; sendable: number; threshold: number }
    | { status: 'failed'; reason: SendFailureReason; counts: SendCounts };

export interface SendToDeps {
    source: PhotoPathSource;
    fileExists(filePath: string): Promise<boolean>;
    targets: readonly SendTarget[];
    /** Read on every send, so a changed setting applies without a restart. */
    getSettings(): SendToSettings;
    /**
     * True when two paths that differ only in letter case are the same file (Windows). The library can hold
     * such a file twice, for example when a folder was scanned once as d:\photos and once as D:\Photos.
     * Defaults to the current platform.
     */
    caseInsensitivePaths?: boolean;
}

const EXISTENCE_CHECKS_AT_ONCE = 32;
const NOTHING: SendCounts = { requested: 0, missing: 0, sent: 0 };

/**
 * "Send to..." for a selection or a Smart Album. Resolves the photos to their existing file paths,
 * leaves out missing ones, asks for confirmation on large sends and hands the paths to a target.
 * It only reads: no photo is copied and nothing is written.
 */
export class SendToService {
    private readonly targets: Map<string, SendTarget>;
    private readonly caseInsensitivePaths: boolean;

    constructor(private readonly deps: SendToDeps) {
        this.targets = new Map(deps.targets.map(target => [target.id, target]));
        this.caseInsensitivePaths = deps.caseInsensitivePaths ?? process.platform === 'win32';
    }

    listTargets(): { id: string; label: string }[] {
        return [...this.targets.values()].map(({ id, label }) => ({ id, label }));
    }

    async send(request: SendRequest): Promise<SendOutcome> {
        const target = this.targets.get(request.targetId);
        if (!target) return { status: 'failed', reason: 'unknown_target', counts: NOTHING };

        const resolved = this.resolve(request.source);
        if (!resolved) return { status: 'failed', reason: 'unknown_source', counts: NOTHING };

        const { paths, duplicates } = await this.existingPaths(resolved.rows);
        const missing = resolved.requested - paths.length - duplicates;
        const counts: SendCounts = { requested: resolved.requested, missing, sent: 0 };

        if (paths.length === 0) return { status: 'failed', reason: 'nothing_to_send', counts };

        const { confirmThreshold } = this.deps.getSettings();
        if (paths.length > confirmThreshold && !request.confirmed) {
            return { status: 'needs_confirmation', counts, sendable: paths.length, threshold: confirmThreshold };
        }

        const result = await target.send(paths, this.deps.getSettings());
        const sentCounts: SendCounts = { ...counts, sent: result.handedOver };

        if (!result.ok) return { status: 'failed', reason: result.reason, counts: sentCounts };
        if (result.skippedTooLong) sentCounts.tooLong = result.skippedTooLong;
        return { status: 'sent', counts: sentCounts, batches: result.batches };
    }

    private resolve(source: SendSource): { rows: PhotoPathRow[]; requested: number } | null {
        if (source.kind === 'photos') {
            const ids = [...new Set(source.ids)];
            return { rows: this.deps.source.pathsForPhotoIds(ids), requested: ids.length };
        }
        const rows = this.deps.source.pathsForSmartAlbum(source.albumId);
        return rows ? { rows, requested: rows.length } : null;
    }

    /**
     * Paths of healthy photos whose file is still on disk, each file once, in order. Files are told apart
     * by their FULL path, never by their name: different photos often share a name (a wrapped camera
     * counter, or a RAW and a JPEG). `duplicates` counts rows that were the same file as an earlier row.
     */
    private async existingPaths(rows: readonly PhotoPathRow[]): Promise<{ paths: string[]; duplicates: number }> {
        const healthy = rows.filter(row => row.missingSince === null).map(row => row.filePath);
        const unique = new Map<string, string>();
        for (const filePath of healthy) {
            const key = this.caseInsensitivePaths ? filePath.toLowerCase() : filePath;
            if (!unique.has(key)) unique.set(key, filePath);
        }
        const candidates = [...unique.values()];
        const present: string[] = [];

        for (let start = 0; start < candidates.length; start += EXISTENCE_CHECKS_AT_ONCE) {
            const chunk = candidates.slice(start, start + EXISTENCE_CHECKS_AT_ONCE);
            const found = await Promise.all(chunk.map(filePath => this.deps.fileExists(filePath)));
            chunk.forEach((filePath, index) => { if (found[index]) present.push(filePath); });
        }
        return { paths: present, duplicates: healthy.length - candidates.length };
    }
}
