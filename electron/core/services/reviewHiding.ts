import logger from '../../logger';
import { getNonFaceService } from './NonFaceDeps';

/**
 * Faces the Not a Face? list holds (except turned ones) are left out of Review Needed while the user keeps that setting on
 * (it is on by default). They are not changed in any way: they are still in the database, still unassigned, and are reviewed in
 * Not a Face?, where Keep sends a face back here and Ignore moves it to the Ignored filter.
 */

/** The ids Review Needed leaves out right now. If the list cannot be read, nothing is hidden: Review Needed must never lose faces to an error. */
export function hiddenFromReview(getService: () => { hiddenFromReviewIds(): number[] } = getNonFaceService): Set<number> {
    try {
        return new Set(getService().hiddenFromReviewIds());
    } catch (error) {
        logger.warn(`[ReviewHiding] Could not read the Not a Face? list, nothing is hidden: ${String(error)}`);
        return new Set();
    }
}

export function withoutHidden<T extends { id: number }>(faces: T[], hidden: Set<number>): T[] {
    return hidden.size === 0 ? faces : faces.filter(face => !hidden.has(face.id));
}

/** The count of unassigned faces without the hidden ones (the hidden faces are all unassigned, so they are part of `unassigned`). */
export function countWithoutHidden(unassigned: number, hidden: Set<number>): number {
    return Math.max(0, unassigned - hidden.size);
}
