import { FaceRepository } from '../../data/repositories/FaceRepository';
import logger from '../../logger';
import { getDB } from '../../db';
import { getAISettings, ConfigService } from '../../store';
import { buildScanThresholds } from './scanThresholds';
import { classifyDetection } from './detectionTier';
import { findOverlapGarbage, findExistingFace, findRejectingFace, screenNewDetection, decideAssignment } from './scanDecisions';
import { FaceMatcher } from './FaceMatcher';
import { AutoAssigner } from './AutoAssigner';
import type { SearchFn } from './AutoAssigner';
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

    static readonly AUTO_ASSIGN_DEFAULTS = AutoAssigner.AUTO_ASSIGN_DEFAULTS;

    /** Auto-assign unassigned faces to named people (see AutoAssigner). Matching goes through this class so it can be replaced in tests. */
    static autoAssignFaces(
        faceIds: number[],
        thresholdOverride?: number,
        searchFn?: SearchFn,
        options?: Partial<typeof AutoAssigner.AUTO_ASSIGN_DEFAULTS>
    ) {
        return AutoAssigner.run((descriptors, matchOptions) => this.matchBatch(descriptors, matchOptions), faceIds, thresholdOverride, searchFn, options);
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
            const idsToDelete = findOverlapGarbage(existingFaces, thresholds.dedupIoU);
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
        const facesToMatch = faces.filter(f => f.descriptor && f.descriptor.length > 0);
        const descriptorsToMatch = facesToMatch.map(f => f.descriptor);

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

        // Each detection looks up its own match: a detection skipped further down must not shift the matches of the ones after it.
        const matchByFace = new Map<unknown, FaceMatch | null>(facesToMatch.map((f, i) => [f, matchResults[i] ?? null]));
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

                // Is this detection a stored face seen again? (a stored face can be claimed by one detection only)
                const existing = findExistingFace(face.box, existingFaces, claimedExistingIds, thresholds.dedupIoU);
                const bestMatch: any = existing.face;
                if (existing.clash) {
                    logger.info(`[FaceService] Face clash! Face already claimed by another detection. Treating face ${faceIdx} as distinct.`);
                } else if (bestMatch) {
                    claimedExistingIds.add(bestMatch.id);
                    matchedFaceIds.add(bestMatch.id);
                    logger.info(`[FaceService] Face ${faceIdx} matched existing face ID ${bestMatch.id} (IoU=${existing.iou.toFixed(2)}). Will UPDATE.`);
                } else {
                    logger.info(`[FaceService] Face ${faceIdx} has no match. Will INSERT as new.`);
                }

                // [Phase 79 Fix] Rejection Memory: a new detection inside a face that was thrown out (hands, sand, ...) is skipped
                const rejectedBy = bestMatch ? null : findRejectingFace(face.box, ignoredFaces);
                if (rejectedBy) {
                    logger.info(`[FaceService] SKIPPING face ${faceIdx} - overlaps with ignored face ${rejectedBy.id}. Rejection memory working.`);
                    continue;
                }

                // Prepare Data
                let descriptorBuffer = null;
                let matchData: FaceMatch | null = null;

                if (face.descriptor && Array.isArray(face.descriptor)) {
                    descriptorBuffer = Buffer.from(new Float32Array(face.descriptor).buffer);
                    if (face.descriptor.length > 0) {
                        matchData = matchByFace.get(face) ?? null;
                        if (matchData) {
                            logger.debug(`[FaceService] Scan match for face: dist = ${matchData.distance.toFixed(3)}, person = ${matchData.personId} `);
                        }
                    }
                }

                // Person, tier and source: inherited from the stored face (an update), or fresh (a new face; source 'ai_scan', never 'manual').
                // A match then assigns or suggests a person, see decideAssignment.
                const detectionIsSolid = bestMatch?.entity_type !== 'suspect'
                    && classifyDetection(face.score ?? 0.95, face.box, ACCEPT_SCORE) === 'human';
                const assignment = decideAssignment(
                    {
                        personId: bestMatch ? bestMatch.person_id : null,
                        suggestedPersonId: bestMatch ? bestMatch.suggested_person_id : null,
                        tier: bestMatch ? bestMatch.confidence_tier : 'unknown',
                        source: bestMatch ? bestMatch.assignment_source : 'ai_scan',
                        confirmed: bestMatch ? bestMatch.is_confirmed : 0,
                        matchDistance: bestMatch ? bestMatch.match_distance : null,
                    },
                    matchData, detectionIsSolid, face.faceQuality ?? 0.5, thresholds,
                );
                const { personId, suggestedPersonId, tier: confidenceTier, source: assignmentSource, confirmed: isConfirmed, matchDistance } = assignment;
                if (assignment.newlyAssigned) assignedCount++;

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
                    const detectionScore = face.score ?? 0.95;
                    const box = face.box;

                    // Below the reject line only a large face with a fair score is kept (see screenNewDetection)
                    const screening = screenNewDetection(detectionScore, box, thresholds);
                    if (!screening.keep) {
                        logger.info(`[FaceService] REJECT face ${faceIdx} — score ${detectionScore.toFixed(2)} < ${thresholds.rejectFloor}`);
                        continue;
                    }
                    if (screening.byException) {
                        logger.info(`[FaceService] LOW SCORE EXCEPTION: Face ${faceIdx} (score ${detectionScore.toFixed(2)}) accepted because it is LARGE (${box.width.toFixed(0)}px width).`);
                    }

                    // Accept (>= 0.70) → 'human', otherwise 'suspect'; a large or oddly shaped box is 'suspect' too
                    const entityType = classifyDetection(detectionScore, box, ACCEPT_SCORE);

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
                // Ignored faces are the rejection memory (boxes the vision check or the user threw out); they are never pruned.
                const pruneCandidates = orphanFaces.filter((f: any) => !f.is_confirmed && f.is_ignored !== 1);

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

