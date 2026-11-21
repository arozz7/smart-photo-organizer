import logger from '../../logger';
import { getNonFaceService } from './NonFaceDeps';
import { getPictureSuggestionService } from './PictureDeps';

/**
 * Faces the Not a Face? list holds (except turned ones) and the unassigned faces of the Pictures? list are left out of Review Needed while the
 * user keeps those settings on (both are on by default). They are not changed in any way: they are still in the database, still unassigned,
 * and are reviewed in their own lists, where Keep sends a face back to Review Needed and Ignore moves it to the Ignored filter.
 */

type HiddenSource = () => { hiddenFromReviewIds(): number[] };

const APP_SOURCES: HiddenSource[] = [getNonFaceService, getPictureSuggestionService];

/**
 * The ids Review Needed leaves out right now. If a list cannot be read, it hides nothing: Review Needed must never lose faces to an error
 * (the other list still hides its faces).
 */
export function hiddenFromReview(sources: HiddenSource[] = APP_SOURCES): Set<number> {
    const hidden = new Set<number>();
    for (const source of sources) {
        try {
            for (const id of source().hiddenFromReviewIds()) hidden.add(id);
        } catch (error) {
            logger.warn(`[ReviewHiding] Could not read a suggestion list, it hides nothing: ${String(error)}`);
        }
    }
    return hidden;
}

export function withoutHidden<T extends { id: number }>(faces: T[], hidden: Set<number>): T[] {
    return hidden.size === 0 ? faces : faces.filter(face => !hidden.has(face.id));
}

/** The count of unassigned faces without the hidden ones (the hidden faces are all unassigned, so they are part of `unassigned`). */
export function countWithoutHidden(unassigned: number, hidden: Set<number>): number {
    return Math.max(0, unassigned - hidden.size);
}
