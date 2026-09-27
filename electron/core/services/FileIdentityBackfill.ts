import type { FileIdentity } from '../../scanning/fileIdentity';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';
import type { PhotoNeedingIdentity } from '../../data/repositories/PhotoIdentityRepository';

export interface IdentityBackfillRepository {
    getPhotosNeedingIdentity(afterId: number, limit: number): PhotoNeedingIdentity[];
    setIdentityBatch(entries: { id: number; identity: FileIdentity }[]): void;
}

export interface IdentityBackfillDependencies {
    repository: IdentityBackfillRepository;
    readIdentity: (filePath: string) => Promise<FileIdentity | null>;
    /** True while a scan or AI work is running: the backfill waits, so it never competes with them. */
    isBusy: () => boolean;
    sleep: (ms: number) => Promise<void>;
    /** Photos handled per database transaction. */
    batchSize?: number;
    /** Files stat'ed at once. */
    readConcurrency?: number;
    /** Pause between batches and while busy. */
    pauseMs?: number;
}

export interface IdentityBackfillResult {
    updated: number;
    /** Files that could not be read (moved, deleted, offline drive); left without an identity. */
    unreadable: number;
}

/**
 * Records size / modified time / file id for photos indexed before those were tracked. The scanner fills them
 * in for new photos and on every visit, but this covers photos that are not rescanned for a long time, which
 * matters most for the files that later move (their identity has to be recorded before the move).
 *
 * Works through the library once with an id cursor, so unreadable files are passed over rather than retried.
 */
export class FileIdentityBackfill {
    private stopRequested = false;
    private readonly batchSize: number;
    private readonly readConcurrency: number;
    private readonly pauseMs: number;

    constructor(private readonly deps: IdentityBackfillDependencies) {
        this.batchSize = deps.batchSize ?? 500;
        this.readConcurrency = deps.readConcurrency ?? 8;
        this.pauseMs = deps.pauseMs ?? 1000;
    }

    stop(): void {
        this.stopRequested = true;
    }

    async run(): Promise<IdentityBackfillResult> {
        const result: IdentityBackfillResult = { updated: 0, unreadable: 0 };
        let cursor = 0;

        while (!this.stopRequested) {
            if (this.deps.isBusy()) {
                await this.deps.sleep(this.pauseMs);
                continue;
            }

            const batch = this.deps.repository.getPhotosNeedingIdentity(cursor, this.batchSize);
            if (batch.length === 0) break;
            cursor = batch[batch.length - 1].id;

            const identities = await mapWithConcurrency(batch, this.readConcurrency, photo => this.deps.readIdentity(photo.file_path));
            const entries = batch.flatMap((photo, index) => (identities[index] ? [{ id: photo.id, identity: identities[index] as FileIdentity }] : []));

            if (entries.length > 0) this.deps.repository.setIdentityBatch(entries);
            result.updated += entries.length;
            result.unreadable += batch.length - entries.length;

            await this.deps.sleep(this.pauseMs); // breathing room between batches
        }

        return result;
    }
}
