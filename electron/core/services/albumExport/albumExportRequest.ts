import path from 'node:path';
import { z } from 'zod';

const albumExportSchema = z.object({
    photoIds: z.array(z.number().int().positive()).min(1).max(100_000),
    targetDir: z.string().min(1).refine(dir => path.isAbsolute(dir), 'target folder must be an absolute path'),
});

export interface AlbumExportRequest {
    photoIds: number[];
    targetDir: string;
}

/** Validates the Export Album request from the renderer. Returns null when it is not valid. */
export function parseAlbumExportRequest(payload: unknown): AlbumExportRequest | null {
    const parsed = albumExportSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
}
