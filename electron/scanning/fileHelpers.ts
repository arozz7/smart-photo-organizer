import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import logger from '../logger';

/** SHA-256 of a file as hex, or null if it cannot be read. */
export async function computeSHA256(filePath: string): Promise<string | null> {
    try {
        return await new Promise((resolve, reject) => {
            const hash = createHash('sha256');
            const stream = createReadStream(filePath);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    } catch (e) {
        logger.warn(`[Scanner] SHA-256 failed for ${path.basename(filePath)}:`, e);
        return null;
    }
}

/** True when a preview file exists and is non-empty. */
export async function isPreviewUsable(previewPath: string | null): Promise<boolean> {
    if (!previewPath) return false;
    try {
        return (await fs.stat(previewPath)).size > 0;
    } catch {
        return false;
    }
}
