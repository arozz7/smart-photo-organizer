import { z } from 'zod';
import type { VisibilityFace, VisibilityResult } from './FaceVisibilityService';

/** The first call loads the vision model (about 40 s); a batch of eight faces then takes a few seconds. */
const SCORE_TIMEOUT_MS = 120_000;

export type SendRequest = (type: string, payload: unknown, timeoutMs: number) => Promise<unknown>;

const replySchema = z.object({
    results: z.array(z.object({
        faceId: z.number().int(),
        score: z.number().finite().nullable(),
        error: z.string().optional(),
    })),
});

/**
 * Asks the engine's vision model "is a clear face visible?" about a few faces (command `score_face_visibility`).
 * Throws when the whole call fails; a face that could not be scored comes back with a null score and its own error.
 */
export async function scoreWithEngine(faces: VisibilityFace[], send: SendRequest): Promise<VisibilityResult[]> {
    if (faces.length === 0) return [];
    const items = faces.map(face => ({ faceId: face.id, imagePath: face.imagePath, box: face.box, photoWidth: face.photoWidth }));
    const reply = await send('score_face_visibility', { items }, SCORE_TIMEOUT_MS);

    const failure = reply && typeof reply === 'object' ? (reply as { success?: unknown; error?: unknown }) : {};
    if (failure.success === false || typeof failure.error === 'string') {
        throw new Error(typeof failure.error === 'string' ? failure.error : 'The engine could not score the faces');
    }
    const parsed = replySchema.safeParse(reply);
    if (!parsed.success) throw new Error('The engine gave an invalid reply');
    return parsed.data.results;
}

/** The preview image when it is on disk (smaller and quicker to open), otherwise the photo itself. */
export function pickImagePath(previewPath: string | null, filePath: string | null, exists: (path: string) => boolean): string | null {
    if (previewPath && exists(previewPath)) return previewPath;
    return filePath;
}
