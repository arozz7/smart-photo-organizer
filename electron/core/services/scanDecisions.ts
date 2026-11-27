import { boxIoU, boxIoMin } from './faceBoxes';
import type { FaceBox } from './faceBoxes';
import type { FaceMatch } from './FaceMatcher';
import type { ScanThresholds } from './scanThresholds';
import { FaceAnalysisService } from './FaceAnalysisService';

/**
 * The decisions a scan makes about a photo's detections, as plain functions (no database, no settings reads):
 * what to do with faces already stored, whether a new detection is kept, and whether a match becomes an assignment.
 */

/** A face already stored for the photo (the fields the decisions look at). */
export interface StoredFace {
    id: number;
    box: FaceBox;
    score?: number | null;
    is_confirmed?: number | null;
    is_ignored?: number | null;
    person_id?: number | null;
    suggested_person_id?: number | null;
    confidence_tier?: string | null;
    match_distance?: number | null;
    assignment_source?: string | null;
    entity_type?: string | null;
}

/** Stored faces sitting on top of each other: the ids to delete. Higher score wins; a confirmed face is never deleted. */
export function findOverlapGarbage(existing: StoredFace[], dedupIoU: number): Set<number> {
    const toDelete = new Set<number>();
    const byScore = [...existing].sort((a, b) => (b.score || 0) - (a.score || 0));

    for (let i = 0; i < byScore.length; i++) {
        if (toDelete.has(byScore[i].id)) continue;
        for (let j = i + 1; j < byScore.length; j++) {
            if (toDelete.has(byScore[j].id)) continue;
            const kept = byScore[i];
            const other = byScore[j];
            if (boxIoU(kept.box, other.box) <= dedupIoU) continue;

            if (other.is_confirmed && !kept.is_confirmed) {
                toDelete.add(kept.id);
            } else if (!other.is_confirmed) {
                toDelete.add(other.id);
            }
        }
    }
    return toDelete;
}

export interface ExistingFaceMatch {
    /** The stored face this detection is a new reading of, or null when it is a new face. */
    face: StoredFace | null;
    iou: number;
    /** True when the best stored face was already taken by an earlier detection (the detection then counts as new). */
    clash: boolean;
}

/** Which stored face (if any) a detection is the same face as: the best overlap above the line, unless already claimed. */
export function findExistingFace(box: FaceBox, existing: StoredFace[], claimedIds: ReadonlySet<number>, dedupIoU: number): ExistingFaceMatch {
    let best: StoredFace | null = null;
    let bestIoU = 0;
    for (const stored of existing) {
        const iou = boxIoU(box, stored.box);
        if (iou > dedupIoU && iou > bestIoU) {
            bestIoU = iou;
            best = stored;
        }
    }
    if (best && claimedIds.has(best.id)) return { face: null, iou: bestIoU, clash: true };
    return { face: best, iou: bestIoU, clash: false };
}

const REJECTION_OVERLAP = 0.5;

/** The thrown-out face (rejection memory) that covers more than half of the detection, or null. */
export function findRejectingFace(box: FaceBox, ignored: StoredFace[]): StoredFace | null {
    return ignored.find(f => boxIoMin(box, f.box) > REJECTION_OVERLAP) ?? null;
}

export interface Screening {
    keep: boolean;
    /** Kept although the score is under the reject line, because the face is large. */
    byException: boolean;
}

const LARGE_FACE_MIN_SCORE = 0.15;
const SQUARE_BOX_MIN_SCORE = 0.25;
const SQUARE_TOLERANCE = 0.05;

/** Whether a new detection is kept: below the reject line only a large face with a fair score survives. */
export function screenNewDetection(score: number, box: FaceBox, t: Pick<ScanThresholds, 'rejectFloor' | 'largeFaceWidth'>): Screening {
    if (score >= t.rejectFloor) return { keep: true, byException: false };

    const isLarge = box.width > t.largeFaceWidth;
    const aspect = box.height > 0 ? box.width / box.height : 1.0;
    const isSquare = Math.abs(aspect - 1.0) < SQUARE_TOLERANCE;
    const keeps = isLarge && score >= LARGE_FACE_MIN_SCORE && (!isSquare || score > SQUARE_BOX_MIN_SCORE);
    return { keep: keeps, byException: keeps };
}

export interface AssignmentState {
    personId: number | null;
    suggestedPersonId: number | null;
    tier: string;
    source: string;
    confirmed: number;
    matchDistance: number | null;
}

export interface Assignment extends AssignmentState {
    /** True when this scan gave the face a person it did not have. */
    newlyAssigned: boolean;
}

/**
 * What a match does to a face. A close match assigns the person only for a solid detection ('human') and only to a face
 * that has no person yet; anything else within the review line becomes a suggestion. A face that already has a person keeps it.
 */
export function decideAssignment(
    current: AssignmentState,
    match: FaceMatch | null,
    detectionIsSolid: boolean,
    faceQuality: number,
    t: Pick<ScanThresholds, 'autoAssign' | 'review'>,
): Assignment {
    if (!match) return { ...current, newlyAssigned: false };

    const result: Assignment = { ...current, matchDistance: match.distance, newlyAssigned: false };
    const highLine = FaceAnalysisService.getQualityAdjustedThreshold(t.autoAssign, faceQuality);
    const reviewLine = FaceAnalysisService.getQualityAdjustedThreshold(t.review, faceQuality);

    if (match.distance < highLine && detectionIsSolid) {
        if (!current.personId) {
            result.personId = match.personId;
            result.tier = 'high';
            result.suggestedPersonId = match.personId;
            result.source = 'auto_scan';
            result.confirmed = 0;
            result.newlyAssigned = true;
        }
    } else if (match.distance < reviewLine) {
        if (!current.personId) {
            result.tier = 'review';
            result.suggestedPersonId = match.personId;
        }
    }
    return result;
}
