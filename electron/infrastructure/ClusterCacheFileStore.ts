import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import logger from '../logger';
import type { CachedClustering, ClusterCacheStore } from '../core/services/clusterCache';

const EntrySchema = z.object({
    optionsKey: z.string(),
    faceIds: z.array(z.number().int()),
    clusters: z.array(z.array(z.number().int())),
    singles: z.array(z.number().int()),
});

/**
 * Keeps the remembered clustering in one JSON file in the user data folder, so it survives a restart. The file is only a speed-up: a missing,
 * damaged or unwritable file means "nothing remembered", never an error. It is written whole to a temporary file and renamed, so a crash cannot
 * leave half a file.
 */
export class ClusterCacheFileStore implements ClusterCacheStore {
    constructor(private readonly filePath: string) {}

    load(): CachedClustering | null {
        let text: string;
        try {
            text = fs.readFileSync(this.filePath, 'utf-8');
        } catch {
            return null; // no file yet
        }
        try {
            const parsed = EntrySchema.safeParse(JSON.parse(text));
            return parsed.success ? parsed.data : null;
        } catch {
            logger.warn('[ClusterCache] Ignoring a damaged cache file');
            return null;
        }
    }

    save(entry: CachedClustering): void {
        const temporary = `${this.filePath}.tmp`;
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify(entry), 'utf-8');
            fs.renameSync(temporary, this.filePath);
        } catch (error) {
            logger.warn({ error }, '[ClusterCache] Could not save the cache file');
            try { fs.rmSync(temporary, { force: true }); } catch { /* nothing to clean */ }
        }
    }
}
