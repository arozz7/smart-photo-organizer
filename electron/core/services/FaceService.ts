import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { PersonService } from './PersonService';
import logger from '../../logger';
import { getDB } from '../../db';
import { getAISettings, ConfigService } from '../../store';
import { buildScanThresholds } from './scanThresholds';
import { FaceAnalysisService } from './FaceAnalysisService';
import { classifyDetection } from './detectionTier';
import { boxIoU, boxIoMin } from './faceBoxes';
import { FaceMatcher } from './FaceMatcher';
import type { FaceMatch } from './FaceMatcher';

export type { FaceMatch, MatchOptions } from './FaceMatcher';

/**
 * Scan-time face handling. Matching a descriptor to a person lives in FaceMatcher; the methods below that
 * start with "match" and calculateL2Distance are thin delegates so every caller keeps working.
 */
export class FaceService {

    static matchFace(...args: Parameters<typeof FaceMatcher.matchFace>) {
        return FaceMatcher.matchFace(...args);
    }

    static matchBatch(...args: Parameters<typeof FaceMatcher.matchBatch>) {
        return FaceMatcher.matchBatch(...args);
    }

    static matchAgainstCentroids(...args: Parameters<typeof FaceMatcher.matchAgainstCentroids>) {
        return FaceMatcher.matchAgainstCentroids(...args);
    }

    static calculateL2Distance(...args: Parameters<typeof FaceMatcher.calculateL2Distance>) {
        return FaceMatcher.calculateL2Distance(...args);
    }

    /**
     * Options for auto-assign operation.
     */
    static readonly AUTO_ASSIGN_DEFAULTS = {
        maxAssignmentsPerPerson: 50,   // Cap to prevent single person absorbing wrong faces
        tierFilter: ['high'] as string[], // Only assign high-confidence by default
        deferRecalculation: false,      // Recalc at end by default
        useFaissFallback: false         // Disable FAISS for bulk to prevent voting issues
    };

    /**
     * Auto-assign unassigned faces to named people.
     * 
     * CRITICAL FIXES (v0.5.1):
     * - Freeze centroids at start (no mid-batch recalculation)
     * - Filter by confidence tier (only 'high' by default)
     * - Cap assignments per person (prevent cascade absorption)
     * - Return queued/capped faces for user review
     */
    static async autoAssignFaces(
        faceIds: number[],
        thresholdOverride?: number,
        searchFn?: SearchFn,
        options?: Partial<typeof FaceService.AUTO_ASSIGN_DEFAULTS>
    ) {
        const opts = { ...this.AUTO_ASSIGN_DEFAULTS, ...options };
        const settings = getAISettings();

        // Thresholds for tier classification (L2 distance - lower is better)
        const HIGH_THRESHOLD = thresholdOverride ?? settings.autoAssignThreshold ?? 0.7;
        const REVIEW_THRESHOLD = settings.reviewThreshold || 0.9;

        try {
            // 1. FREEZE CENTROIDS at start - prevents cascade drift
            const frozenCentroids = PersonRepository.getPeopleWithDescriptors();
            logger.info(`[AutoAssign] Frozen ${frozenCentroids.length} person centroids for batch operation.`);

            // 2. Get faces to process
            const candidates = FaceRepository.getFacesForClustering();
            const faces = faceIds && faceIds.length > 0
                ? candidates.filter((f: any) => faceIds.includes(f.id))
                : candidates;

            if (faces.length === 0) {
                return { success: true, count: 0, assigned: [], queuedForReview: [], capped: [] };
            }

            logger.info(`[AutoAssign] Processing ${faces.length} faces against ${frozenCentroids.length} people...`);

            // 3. Match ALL faces in single pass against FROZEN centroids
            const matchResults = await this.matchBatch(
                faces.map((f: any) => f.descriptor),
                {
                    threshold: REVIEW_THRESHOLD, // Capture all candidates up to review tier
                    candidatePeople: frozenCentroids,
                    searchFn: opts.useFaissFallback ? searchFn : undefined
                }
            );

            // 4. Process matches with filtering
            const assigned: { faceId: number; personId: number; similarity: number; tier: string }[] = [];
            const queuedForReview: { faceId: number; personId: number; distance: number; personName: string }[] = [];
            const capped: { faceId: number; personId: number; reason: string }[] = [];
            const assignmentCounts = new Map<number, number>();
            const affectedPeople = new Set<number>();

            for (let i = 0; i < faces.length; i++) {
                const match = matchResults[i];
                if (!match) continue;

                const face = faces[i];
                const dist = match.distance;

                // Determine tier
                let tier = 'unknown';
                if (dist < HIGH_THRESHOLD) {
                    tier = 'high';
                } else if (dist < REVIEW_THRESHOLD) {
                    tier = 'review';
                }

                // Check tier filter
                if (!opts.tierFilter.includes(tier)) {
                    if (tier === 'review') {
                        queuedForReview.push({
                            faceId: face.id,
                            personId: match.personId,
                            distance: dist,
                            personName: match.personName
                        });
                    }
                    continue;
                }

                // Check per-person cap
                const currentCount = assignmentCounts.get(match.personId) ?? 0;
                if (currentCount >= opts.maxAssignmentsPerPerson) {
                    capped.push({
                        faceId: face.id,
                        personId: match.personId,
                        reason: `Exceeded ${opts.maxAssignmentsPerPerson} assignments for ${match.personName}`
                    });
                    continue;
                }

                // Assign!
                assigned.push({
                    faceId: face.id,
                    personId: match.personId,
                    similarity: match.similarity,
                    tier
                });
                assignmentCounts.set(match.personId, currentCount + 1);
                affectedPeople.add(match.personId);
            }

            // 5. Batch commit assignments
            if (assigned.length > 0) {
                // Group by person for efficient batch update
                const groupedByPerson = new Map<number, number[]>();
                for (const a of assigned) {
                    const existing = groupedByPerson.get(a.personId) || [];
                    existing.push(a.faceId);
                    groupedByPerson.set(a.personId, existing);
                }

                for (const [personId, faceIdList] of groupedByPerson) {
                    FaceRepository.updateFacePerson(faceIdList, personId);
                }
            }

            // 6. Recalculate means ONCE at end (not per-pass)
            if (!opts.deferRecalculation && affectedPeople.size > 0) {
                logger.info(`[AutoAssign] Recalculating means for ${affectedPeople.size} affected people...`);
                for (const pid of affectedPeople) {
                    await PersonService.recalculatePersonMean(pid);
                }
            }

            // 7. Log results
            logger.info(`[AutoAssign] Complete: ${assigned.length} assigned, ${queuedForReview.length} queued for review, ${capped.length} capped`);

            return {
                success: true,
                count: assigned.length,
                assigned,
                queuedForReview,
                capped,
                affectedPeople: Array.from(affectedPeople)
            };

        } catch (e) {
            logger.error("Auto-Assign failed:", e);
            return { success: false, error: String(e) };
        }
    }

    static async processAnalysisResult(
        photoId: number,
        faces: any[],
        width: number,
        height: number,
        aiProvider: any,
        sessionData?: { sessionFolder?: string; sessionDate?: string }
    ) {
        logger.info(`[FaceService] Processing ${faces.length} faces for photo ${photoId}`);
        const db = getDB();
        const thresholds = buildScanThresholds(getAISettings(), ConfigService.getAdvancedFaceSettings());
        // [Phase 79 Fix] Load ALL faces including ignored ones for proper cleanup
        // Without this, ignored faces are invisible to deduplication and get re-inserted as new faces
        let existingFaces = FaceRepository.getFacesByPhotoIncludingIgnored(photoId) as any[];

        // [Phase 79 Fix] Extract ignored faces for rejection memory filtering
        // These faces were VLM-rejected (hands, sand, etc.) and should NOT be deleted.
        // We'll use them to filter out new detections that overlap with them.
        const ignoredFaces = existingFaces.filter((f: any) => f.is_ignored === 1);
        if (ignoredFaces.length > 0) {
            logger.info(`[FaceService] Found ${ignoredFaces.length} ignored faces (rejection memory). Will use to filter new detections.`);
        }

        // [Phase 68.5] Pre-Pass: Clean existing DB overlaps (Garbage Collection)
        try {
            const idsToDelete = new Set<number>();

            const sortedExisting = [...existingFaces].sort((a: any, b: any) => (b.score || 0) - (a.score || 0)); // High score first

            for (let i = 0; i < sortedExisting.length; i++) {
                if (idsToDelete.has(sortedExisting[i].id)) continue;
                for (let j = i + 1; j < sortedExisting.length; j++) {
                    if (idsToDelete.has(sortedExisting[j].id)) continue;

                    const f1: any = sortedExisting[i];
                    const f2: any = sortedExisting[j];

                    if (boxIoU(f1.box, f2.box) > thresholds.dedupIoU) {
                        const f1Protected = f1.is_confirmed;
                        const f2Protected = f2.is_confirmed;

                        if (f2Protected && !f1Protected) {
                            idsToDelete.add(f1.id);
                        } else if (!f2Protected) {
                            idsToDelete.add(f2.id);
                        }
                    }
                }
            }
            if (idsToDelete.size > 0) {
                const idArray = Array.from(idsToDelete);
                const placeholders = idArray.map(() => '?').join(',');
                // We are not in a transaction yet, so we can run this directly.
                // Actually, verify if getFacesByPhoto starts one? No.
                db.prepare(`DELETE FROM faces WHERE id IN (${placeholders})`).run(...idArray);
                existingFaces = existingFaces.filter((f: any) => !idsToDelete.has(f.id));
                logger.info(`[FaceService] Pre-Pass: Deleted ${idsToDelete.size} overlapping garbage faces.`);
            }
        } catch (e) {
            logger.error(`[FaceService] Pre-Pass failed: ${e}`);
        }

        if (width && height) {
            try { db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?').run(width, height, photoId); } catch (e) { /* best effort: the stored size is only a cache */ }
        }

        const insertedIds: number[] = [];
        const facesForFaiss: { id: number, descriptor: number[] }[] = [];

        // --- PHASE 2: Scan-Time Classification ---
        // Match all new faces against library before insertion
        // This avoids a separate auto-assign step multiple times
        const descriptorsToMatch = faces
            .filter(f => f.descriptor && f.descriptor.length > 0)
            .map(f => f.descriptor);

        // Pre-calculate matches for all faces (returns null if no match found within default threshold)
        // IMPORTANT: FAISS uses L2 distance on NORMALIZED vectors (range 0-2, lower = better match)
        // Read thresholds from settings
        const HIGH_THRESHOLD = thresholds.autoAssign;     // L2 distance for auto-assign
        const REVIEW_THRESHOLD = thresholds.review;       // L2 distance for review tier
        const SEARCH_CUTOFF = thresholds.searchCutoff;    // Search a bit beyond review tier
        let matchResults: (FaceMatch | null)[] = [];
        if (descriptorsToMatch.length > 0) {
            matchResults = await this.matchBatch(descriptorsToMatch, {
                threshold: SEARCH_CUTOFF, // L2 distance - captures all candidates within review range
                searchFn: aiProvider ? async (d, k, t) => aiProvider.searchFaces(d, k, t) : undefined
            });
            // DEBUG: Track tier classification statistics
            const matchCount = matchResults.filter(m => m !== null).length;
            const highCount = matchResults.filter(m => m && m.distance < HIGH_THRESHOLD).length;
            const reviewCount = matchResults.filter(m => m && m.distance >= HIGH_THRESHOLD && m.distance < REVIEW_THRESHOLD).length;
            logger.info(`[FaceService] Tier Stats: ${descriptorsToMatch.length} descriptors, ${matchCount} matched, ${highCount} high, ${reviewCount} review (thresholds: high<${HIGH_THRESHOLD}, review<${REVIEW_THRESHOLD})`);
        }

        let matchIdx = 0;
        let assignedCount = 0;

        // Scan-time assignment needs a sure detection ('human'); a weak one that looks like a person (animal, object, picture) stays a suggestion.
        const ACCEPT_SCORE = thresholds.acceptScore;

        const updateStmt = db.prepare(`
            UPDATE faces 
            SET descriptor = ?, box_json = ?, blur_score = ?,
            confidence_tier = ?, suggested_person_id = ?, match_distance = ?,
            pose_yaw = ?, pose_pitch = ?, pose_roll = ?, face_quality = ?,
            session_folder = COALESCE(session_folder, ?),
            session_date = COALESCE(session_date, ?),
            person_id = COALESCE(person_id, ?),
            assignment_source = COALESCE(assignment_source, ?),
            is_confirmed = COALESCE(is_confirmed, ?),
            estimated_age = COALESCE(estimated_age, ?),
            gender = COALESCE(gender, ?),
            entity_type = COALESCE(entity_type, ?),
            score = COALESCE(score, ?)
            WHERE id = ?
        `);

        const insertStmt = db.prepare(`
            INSERT INTO faces(
                photo_id, person_id, descriptor, box_json, blur_score,
                is_reference, confidence_tier, suggested_person_id, match_distance,
                pose_yaw, pose_pitch, pose_roll, face_quality,
                session_folder, session_date, needs_bucketing,
                assignment_source, is_confirmed, estimated_age, gender,
                entity_type, score, verification_attempts
            )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

        db.transaction(() => {
            // [Phase 74] Removed duplicate deduplication - already handled in pre-pass above
            // The duplicate code was using hardcoded iou > 0.3 threshold which was too aggressive
            // and was re-merging faces that Python NMS had correctly kept separate

            const matchedFaceIds = new Set<number>();
            const claimedExistingIds = new Set<number>(); // [Phase 68] Track claimed matches

            let faceIdx = 0;
            for (const face of faces) {
                faceIdx++;
                logger.info(`[FaceService] Processing face ${faceIdx}/${faces.length} - Box: x=${face.box.x.toFixed(0)}, y=${face.box.y.toFixed(0)}, w=${face.box.width.toFixed(0)}, h=${face.box.height.toFixed(0)}, score=${face.score?.toFixed(2) ?? 'N/A'}`);

                // Deduplication Logic
                let bestMatch: any = null;
                let maxIoU = 0;

                for (const oldFace of existingFaces) {
                    const iou = boxIoU(face.box, oldFace.box);

                    if (iou > thresholds.dedupIoU && iou > maxIoU) {
                        maxIoU = iou;
                        bestMatch = oldFace;
                    }
                }

                // [Phase 68] Claim Check
                if (bestMatch) {
                    if (claimedExistingIds.has(bestMatch.id)) {
                        logger.info(`[FaceService] Face clash! Face ${bestMatch.id} already claimed by another detection. Treating new face as distinct.`);
                        bestMatch = null; // Force insert as new
                    } else {
                        claimedExistingIds.add(bestMatch.id);
                        matchedFaceIds.add(bestMatch.id);
                        logger.info(`[FaceService] Face ${faceIdx} matched existing face ID ${bestMatch.id} (IoU=${maxIoU.toFixed(2)}). Will UPDATE.`);
                    }
                } else {
                    logger.info(`[FaceService] Face ${faceIdx} has no match. Will INSERT as new.`);
                }

                // [Phase 79 Fix] Rejection Memory Filter
                // Skip new detections that overlap with ignored faces (VLM-rejected non-face boxes)
                // This prevents re-detection of hands, sand, body parts, etc. on rescans
                if (!bestMatch) { // Only check for new faces, not updates
                    let overlapsWithIgnored = false;
                    for (const ignoredFace of ignoredFaces) {
                        const ioMin = boxIoMin(face.box, ignoredFace.box);

                        // If >50% overlap with ignored face, skip this detection
                        if (ioMin > 0.5) {
                            logger.info(`[FaceService] SKIPPING face ${faceIdx} - overlaps with ignored face ${ignoredFace.id} (IoMin=${ioMin.toFixed(2)}). Rejection memory working.`);
                            overlapsWithIgnored = true;
                            break;
                        }
                    }

                    if (overlapsWithIgnored) {
                        continue; // Skip this face entirely
                    }
                }

                // Prepare Data
                let descriptorBuffer = null;
                let matchData: FaceMatch | null = null;

                if (face.descriptor && Array.isArray(face.descriptor)) {
                    descriptorBuffer = Buffer.from(new Float32Array(face.descriptor).buffer);
                    if (face.descriptor.length > 0) {
                        matchData = matchResults[matchIdx++];
                        if (matchData) {
                            logger.debug(`[FaceService] Scan match for face: dist = ${matchData.distance.toFixed(3)}, person = ${matchData.personId} `);
                        }
                    }
                }

                // Determine Tier & Source
                let personId: number | null = bestMatch ? bestMatch.person_id : null;
                let suggestedPersonId: number | null = bestMatch ? bestMatch.suggested_person_id : null;
                let confidenceTier = bestMatch ? bestMatch.confidence_tier : 'unknown';
                let matchDistance = bestMatch ? bestMatch.match_distance : null;

                // Track Source & Confirmation (Phase 3)
                // [BUG FIX] Default source should be 'ai_scan', NOT 'manual'. 
                // Only inherit if updating existing.
                let assignmentSource = bestMatch ? bestMatch.assignment_source : 'ai_scan';
                let isConfirmed = bestMatch ? bestMatch.is_confirmed : 0;

                if (matchData) {
                    const dist = matchData.distance;
                    matchDistance = dist;
                    const detectionIsSolid = bestMatch?.entity_type !== 'suspect'
                        && classifyDetection(face.score ?? 0.95, face.box, ACCEPT_SCORE) === 'human';


                    // Phase 5: Quality-Adjusted Thresholds
                    const fQuality = face.faceQuality ?? 0.5;
                    const adjHighThreshold = FaceAnalysisService.getQualityAdjustedThreshold(HIGH_THRESHOLD, fQuality);
                    const adjReviewThreshold = FaceAnalysisService.getQualityAdjustedThreshold(REVIEW_THRESHOLD, fQuality);

                    if (dist < adjHighThreshold && detectionIsSolid) {
                        // High Confidence -> Auto Assign
                        if (!personId) {
                            personId = matchData.personId;
                            confidenceTier = 'high';
                            suggestedPersonId = matchData.personId;
                            assignedCount++;
                            // Phase 3: Mark as auto-assigned and unconfirmed
                            assignmentSource = 'auto_scan';
                            isConfirmed = 0;
                        }
                    } else if (dist < adjReviewThreshold) {
                        // Review Tier
                        if (!personId) {
                            confidenceTier = 'review';
                            suggestedPersonId = matchData.personId;
                        }
                    }
                }

                let finalId = 0;

                // Ensure sessionData values are strings
                const sessionFolder = sessionData?.sessionFolder ?? null;
                const sessionDateValue = sessionData?.sessionDate;
                const sessionDateStr = sessionDateValue
                    ? (typeof sessionDateValue === 'string' ? sessionDateValue : (sessionDateValue as any).rawValue ?? JSON.stringify(sessionDateValue))
                    : null;

                if (bestMatch) {
                    // Update
                    updateStmt.run(
                        descriptorBuffer ?? null,
                        JSON.stringify(face.box) ?? null,
                        face.blurScore ?? null,
                        confidenceTier ?? null,
                        suggestedPersonId ?? null,
                        matchDistance ?? null,
                        face.poseYaw ?? null,
                        face.posePitch ?? null,
                        face.poseRoll ?? null,
                        face.faceQuality ?? null,
                        sessionFolder,
                        sessionDateStr,
                        personId ?? null, // Coalesce fallback
                        assignmentSource,
                        isConfirmed,
                        face.estimatedAge ?? null, // Age-Based ERA Categorization
                        face.gender ?? null,       // Age-Based ERA Categorization
                        face.entityType ?? 'human', // Phase 56: VLM Verification
                        face.score ?? null,         // Phase 56: Detection score
                        bestMatch.id
                    );
                    finalId = bestMatch.id;
                } else {
                    // [Phase 90] 3-Tier Detection Score System
                    // Reject (<0.40), Verify/suspect (0.40-0.69), Accept/human (>=0.70)
                    // [Phase 106] Lever 1: raise ceiling to 0.75 in Strict False Positive Mode
                    const REJECT_FLOOR = thresholds.rejectFloor;


                    const detectionScore = face.score ?? 0.95;

                    // Check box characteristics
                    const box = face.box;
                    const boxWidth = box.width || 0;
                    const boxHeight = box.height || 0;
                    const aspectRatio = boxHeight > 0 ? boxWidth / boxHeight : 1.0;
                    const boxArea = boxWidth * boxHeight;

                    const isLargeBox = boxArea > 4000000;

                    // [Phase 91] Large Face Exception: Allow large faces even if score is low (the "large face" setting, 300px by default)
                    // This matches Python detector.py 'Large Face Fallback' logic which keeps them
                    const isLargeWidth = boxWidth > thresholds.largeFaceWidth;
                    const isSquare = Math.abs(aspectRatio - 1.0) < 0.05;

                    if (detectionScore < REJECT_FLOOR) {
                        // [Phase 91b] Refined Filter:
                        // 1. Must be Large (>300px)
                        // 2. Must have Score >= 0.15 (Filters 0.10-0.14 noise) -> preserves vic_krop (0.16)
                        // 3. Must NOT be a low-conf square (noise anchors are often square)
                        if (isLargeWidth && detectionScore >= 0.15 && (!isSquare || detectionScore > 0.25)) {

                            logger.info(`[FaceService] LOW SCORE EXCEPTION: Face ${faceIdx} (score ${detectionScore.toFixed(2)}) accepted because it is LARGE (${boxWidth.toFixed(0)}px width).`);
                        } else {
                            if (isLargeWidth) {
                                logger.info(`[FaceService] REJECT Large Low-Conf Face ${faceIdx}: Score ${detectionScore.toFixed(2)} < 0.15 or Square.`);
                            } else {
                                logger.info(`[FaceService] REJECT face ${faceIdx} — score ${detectionScore.toFixed(2)} < ${REJECT_FLOOR}`);
                            }
                            continue;
                        }
                    }



                    const isUnusualAspect = aspectRatio > 1.6 || aspectRatio < 0.6;

                    // Accept (>= 0.70) → 'human', Verify (0.40-0.69) → 'suspect'
                    // Also flag large/unusual boxes as suspect for multi-face split checking

                    const entityType = classifyDetection(detectionScore, box, ACCEPT_SCORE);

                    if (isLargeBox || isUnusualAspect) {
                        logger.info(`[FaceService] Flagged face as suspect: ${isLargeBox ? `large box (${boxArea.toLocaleString()}px)` : ''} ${isUnusualAspect ? `unusual aspect (${aspectRatio.toFixed(2)})` : ''}`);
                    }

                    const insertParams = [
                        photoId,
                        personId ?? null,
                        descriptorBuffer ?? null,
                        JSON.stringify(face.box) ?? null,
                        face.blurScore ?? null,
                        0, // is_reference
                        confidenceTier ?? 'unknown',
                        suggestedPersonId ?? null,
                        matchDistance ?? null,
                        face.poseYaw ?? null,
                        face.posePitch ?? null,
                        face.poseRoll ?? null,
                        face.faceQuality ?? null,
                        sessionFolder,
                        sessionDateStr,
                        personId ? 0 : 1, // Needs bucketing if unassigned
                        assignmentSource, // assignment_source
                        isConfirmed,      // is_confirmed
                        face.estimatedAge ?? null, // Age-Based ERA Categorization
                        face.gender ?? null,       // Age-Based ERA Categorization
                        entityType,                // Phase 56: VLM Verification
                        detectionScore,            // Phase 56: Detection score
                        0                          // Phase 56: verification_attempts
                    ];

                    // DEBUG: Log parameter count and types
                    logger.info(`[FaceService] INSERT params count: ${insertParams.length}, types: ${insertParams.map((p, i) => `${i}:${p === null ? 'null' : typeof p}`).join(', ')} `);

                    try {
                        const info = insertStmt.run(...insertParams);
                        finalId = Number(info.lastInsertRowid);
                    } catch (insertError) {
                        logger.error(`[FaceService] INSERT FAILED! Params: ${JSON.stringify(insertParams.map(p => p instanceof Buffer ? '[Buffer]' : p))} `);
                        throw insertError;
                    }
                }

                insertedIds.push(finalId);
                // Trigger Recalc if we auto-assigned a NEW person
                if (finalId > 0 && personId && (!bestMatch || bestMatch.person_id !== personId)) {
                    // We'll queue this or handle outside transaction?
                    // actually we can ignore recalc for now or do it batch at end?
                    // AutoAssign loop handled it. We are bypassing AutoAssign loop for "High" tier.
                    // We should recalc means if we auto-assigned.
                }

                // CRITICAL: Only add faces with personId to FAISS
                // This keeps FAISS index clean for suggestion matching
                if (finalId > 0 && personId && face.descriptor && face.descriptor.length > 0) {
                    facesForFaiss.push({ id: finalId, descriptor: face.descriptor });
                }
            }

            // [Phase 67] Cleanup: Prune orphans (Faces in DB but not in this Scan)
            // Safety: Only delete if NOT confirmed. (Manual is NOT protected if unconfirmed)
            const orphanFaces = existingFaces.filter((f: any) => !matchedFaceIds.has(f.id));
            if (orphanFaces.length > 0) {
                const pruneCandidates = orphanFaces.filter((f: any) => !f.is_confirmed);

                if (pruneCandidates.length > 0) {
                    const pruneIds = pruneCandidates.map((f: any) => f.id);
                    logger.info(`[FaceService] Pruning ${pruneIds.length} orphan faces (Ghost/Trash) involved in rescan.`);

                    const placeholders = pruneIds.map(() => '?').join(',');
                    try {
                        db.prepare(`DELETE FROM faces WHERE id IN (${placeholders})`).run(...pruneIds);
                    } catch (e) {
                        logger.error(`[FaceService] Pruning failed: ${e}`);
                    }
                }

                // Log kept orphans (Manual/Confirmed)
                const keptCount = orphanFaces.length - pruneCandidates.length;
                if (keptCount > 0) {
                    logger.info(`[FaceService] Kept ${keptCount} orphan faces (Protected: Confirmed/High-Score Manual).`);
                }
            }
        })();

        // We replaced step `this.autoAssignFaces` with the inline logic above.
        // However, we might want to run re-calcs if we assigned anything.
        if (assignedCount > 0) {
            logger.info(`[FaceService] Auto-assigned ${assignedCount} faces via scan-time logic.`);
        }
    }
}

type SearchFn = (descriptors: number[][], k?: number, threshold?: number) => Promise<{ id: number, distance: number }[][]>;
