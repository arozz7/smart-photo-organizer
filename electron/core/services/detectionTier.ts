export type DetectionTier = 'human' | 'suspect';

interface DetectionBox {
    width: number;
    height: number;
}

/** A box larger than this (in pixels) may hold several faces. */
const LARGE_BOX_AREA = 4_000_000;
/** Width over height outside this range is not the shape of a face. */
const MAX_FACE_ASPECT = 1.6;
const MIN_FACE_ASPECT = 0.6;

/**
 * Whether a detection is accepted as a human face at once ('human') or has to pass the vision-model check first ('suspect').
 * One rule for both places that need it: the entity type stored with a new face, and whether the scan may assign a face to a
 * person (a weak detection that happens to look like a person's face is only a suggestion until the check has passed).
 */
export function classifyDetection(score: number, box: DetectionBox, acceptScore: number): DetectionTier {
    const aspect = box.height > 0 ? box.width / box.height : 1.0;
    const isLargeBox = box.width * box.height > LARGE_BOX_AREA;
    const isUnusualAspect = aspect > MAX_FACE_ASPECT || aspect < MIN_FACE_ASPECT;
    return score >= acceptScore && !isLargeBox && !isUnusualAspect ? 'human' : 'suspect';
}
