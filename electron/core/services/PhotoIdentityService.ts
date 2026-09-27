import logger from '../../logger';
import { PhotoIdentityRepository } from '../../data/repositories/PhotoIdentityRepository';
import { readFileIdentity } from '../../scanning/fileIdentity';

export class PhotoIdentityService {
    /**
     * Call after the app rewrites a photo's file (rotation, ...). Records the file's new identity and clears its
     * stale hashes. Never throws: a failure only means the next scan re-checks the file.
     */
    static async refreshAfterRewrite(photoId: number, filePath: string): Promise<void> {
        try {
            const identity = await readFileIdentity(filePath);
            if (!identity) return;
            PhotoIdentityRepository.markContentRewritten(photoId, identity);
        } catch (e) {
            logger.warn(`[PhotoIdentityService] Could not refresh identity for photo ${photoId}:`, e);
        }
    }
}
