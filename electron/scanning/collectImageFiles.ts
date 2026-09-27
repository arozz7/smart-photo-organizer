import { promises as fs } from 'node:fs';
import path from 'node:path';
import logger from '../logger';
import { isSupportedImageExtension } from '../utils/imageFormats';

export interface CollectedFiles {
    /** Supported image files in depth-first, directory-listing order (the scanner's ordering contract). */
    files: string[];
    totalFiles: number;
    /** Count of skipped files by unsupported extension. */
    skipped: Record<string, number>;
}

/** Walks `root`, skipping dot-directories, and lists the supported image files. */
export async function collectImageFiles(root: string): Promise<CollectedFiles> {
    const result: CollectedFiles = { files: [], totalFiles: 0, skipped: {} };

    const walk = async (directory: string): Promise<void> => {
        try {
            logger.info(`Scanning directory: ${directory}`);
            const entries = await fs.readdir(directory, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);

                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.')) await walk(fullPath);
                } else if (entry.isFile()) {
                    result.totalFiles++;
                    const ext = path.extname(entry.name).toLowerCase();
                    if (isSupportedImageExtension(ext)) {
                        result.files.push(fullPath);
                    } else {
                        result.skipped[ext] = (result.skipped[ext] || 0) + 1;
                    }
                }
            }
        } catch (err) {
            logger.error(`Error scanning ${directory}:`, err);
        }
    };

    await walk(root);
    return result;
}
