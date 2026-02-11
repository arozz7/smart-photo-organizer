import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { PersonService } from './PersonService';
import logger from '../../logger';
import { getDB } from '../../db';
import { getAISettings, ConfigService } from '../../store';
import { FaceAnalysisService } from './FaceAnalysisService';

/**
 * Result of a face matching operation.
 */
export interface FaceMatch {
    personId: number;
    personName: string;
    similarity: number;
    distance: number;
    matchType: 'centroid' | 'faiss';
}

/**
 * Options for face matching, allowing overrides of global settings.
 */
export interface MatchOptions {
    threshold?: number;
    topK?: number;
    candidatePeople?: { id: number, name: string, mean: number[] }[];
    searchFn?: (descriptors: number[][], k?: number, threshold?: number) => Promise<{ id: number, distance: number }[][]>;
}

export class FaceService {

    /**
     * Modular formula for matching a descriptor against the entire library.
     * Uses a Hybrid Strategy: Centroids first, then FAISS fallback.
     */
    static async matchFace(descriptor: any, options: MatchOptions = {}): Promise<FaceMatch | null> {
        const settings = getAISettings();
        const threshold = options.threshold ?? settings.faceSimilarityThreshold ?? 0.65;

        let descArray: number[] = [];
        if (descriptor instanceof Buffer || descriptor instanceof Uint8Array) {
            descArray = Array.from(new Float32Array(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength / 4));
        } else if (typeof descriptor === 'string') {
            descArray = JSON.parse(descriptor);
        } else if (Array.isArray(descriptor)) {
            descArray = descriptor;
        } else {
            return null;
        }

        // 1. Try Centroid Matching (Highly Reliable)
        const candidates = options.candidatePeople ?? PersonRepository.getPeopleWithDescriptors();
        const centroidMatch = this.matchAgainstCentroids(descArray, candidates, threshold);

        if (centroidMatch) return { ...centroidMatch, matchType: 'centroid' };

        // 2. Fallback to FAISS (Individual Face matching)
        if (options.searchFn) {
            const distThreshold = (1 / Math.max(0.01, threshold)) - 1;
            const faissResults = await options.searchFn([descArray], options.topK ?? 5, distThreshold);

            if (faissResults.length > 0 && faissResults[0].length > 0) {
                const matches = faissResults[0];
                const matchedFaceIds = matches.map(m => m.id);

                const db = getDB();
                const placeholders = matchedFaceIds.map(() => '?').join(',');
                const rows = db.prepare(`
                    SELECT f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${placeholders}) AND f.person_id IS NOT NULL 
                    LIMIT 1
                `).all(...matchedFaceIds) as { person_id: number, name: string }[];

                if (rows.length > 0) {
                    const bestMatch = matches[0]; // Already sorted by distance

                    return {
                        personId: rows[0].person_id,
                        personName: rows[0].name,
                        similarity: 1 / (1 + (bestMatch?.distance ?? 0)),
                        distance: bestMatch?.distance ?? 0,
                        matchType: 'faiss'
                    };
                }
            }
        }

        return null;
    }

    /**
     * Efficient batch matching for multiple descriptors.
     */
    static async matchBatch(descriptors: any[], options: MatchOptions = {}): Promise<(FaceMatch | null)[]> {
        const settings = getAISettings();
        const threshold = options.threshold ?? settings.faceSimilarityThreshold ?? 0.65;
        const results: (FaceMatch | null)[] = new Array(descriptors.length).fill(null);

        // Normalize all descriptors
        const parsedDescriptors = descriptors.map(d => {
            if (d instanceof Buffer || d instanceof Uint8Array) {
                return Array.from(new Float32Array(d.buffer, d.byteOffset, d.byteLength / 4));
            }
            if (typeof d === 'string') return JSON.parse(d);
            return d;
        });

        // 1. Centroid Pass
        const candidates = options.candidatePeople ?? PersonRepository.getPeopleWithDescriptors();
        logger.info(`[FaceService] matchBatch: Checking ${parsedDescriptors.length} centroids against ${candidates.length} person candidates (threshold=${threshold}).`);

        for (let i = 0; i < parsedDescriptors.length; i++) {
            const match = this.matchAgainstCentroids(parsedDescriptors[i], candidates, threshold);
            if (match) {
                logger.info(`[FaceService] Centroid Match Found: Face ${i} -> ${match.personName} (dist: ${match.distance.toFixed(3)})`);
                results[i] = { ...match, matchType: 'centroid' };
            } else {
                // Log the closest failure to understand why
                const debugBest = this.matchAgainstCentroids(parsedDescriptors[i], candidates, 10.0); // High threshold
                if (debugBest) {
                    logger.debug(`[FaceService] No match for Face ${i}. Closest candidate: ${debugBest.personName} (dist: ${debugBest.distance.toFixed(3)}) > threshold ${threshold}`);
                } else {
                    logger.debug(`[FaceService] No match for Face ${i} and NO candidates found within safety threshold.`);
                }
            }
        }

        // 2. FAISS Pass for remainders
        const pendingIndices = results.map((r, i) => r === null ? i : -1).filter(i => i !== -1);
        logger.info(`[FaceService] FAISS fallback: ${pendingIndices.length} of ${parsedDescriptors.length} need FAISS lookup`);
        if (pendingIndices.length > 0 && options.searchFn) {
            const pendingDescriptors = pendingIndices.map(i => parsedDescriptors[i]);
            // threshold is already L2 distance, pass directly to FAISS
            const batchFaiss = await options.searchFn(pendingDescriptors, options.topK ?? 5, threshold);

            // Fetch Person IDs for all matched faces in one go
            const allMatchedFaceIds = new Set<number>();
            batchFaiss.forEach(mList => mList.forEach(m => allMatchedFaceIds.add(m.id)));
            logger.info(`[FaceService] FAISS returned ${allMatchedFaceIds.size} unique face matches`);

            if (allMatchedFaceIds.size > 0) {
                const db = getDB();
                const placeholders = Array.from(allMatchedFaceIds).map(() => '?').join(',');
                const rows = db.prepare(`
                    SELECT f.id, f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${placeholders}) AND f.person_id IS NOT NULL
                `).all(...Array.from(allMatchedFaceIds)) as { id: number, person_id: number, name: string }[];

                logger.info(`[FaceService] Of ${allMatchedFaceIds.size} FAISS matches, ${rows.length} belong to named persons`);

                const faceToPerson = new Map<number, { personId: number, name: string }>();
                rows.forEach(r => faceToPerson.set(r.id, { personId: r.person_id, name: r.name }));

                for (let j = 0; j < pendingIndices.length; j++) {
                    const originalIdx = pendingIndices[j];
                    const matches = batchFaiss[j];

                    // Phase 5: Multi-Sample Voting
                    const candidates: { personId: number; distance: number }[] = [];
                    const personNames = new Map<number, string>();

                    for (const m of matches) {
                        if (faceToPerson.has(m.id)) {
                            const p = faceToPerson.get(m.id)!;
                            candidates.push({ personId: p.personId, distance: m.distance });
                            if (!personNames.has(p.personId)) personNames.set(p.personId, p.name);
                        }
                    }

                    const consensus = FaceAnalysisService.consensusVoting(candidates);

                    if (consensus) {
                        results[originalIdx] = {
                            personId: consensus.personId,
                            personName: personNames.get(consensus.personId)!,
                            similarity: 1 / (1 + consensus.distance),
                            distance: consensus.distance,
                            matchType: 'faiss'
                        };
                    } else if (candidates.length > 0) {
                        // Fallback to best single match if voting fails (unlikely)
                        const best = candidates[0];
                        results[originalIdx] = {
                            personId: best.personId,
                            personName: personNames.get(best.personId)!,
                            similarity: 1 / (1 + best.distance),
                            distance: best.distance,
                            matchType: 'faiss'
                        };
                    }
                }
            }
        }

        return results;
    }

    public static matchAgainstCentroids(
        descriptor: number[],
        candidates: { id: number, name: string, mean: number[], eras?: any[], entity_type?: string }[],
        threshold: number,
        entityType: string = 'human'
    ) {
        if (!descriptor || candidates.length === 0) return null;

        // Phase P3: Filter candidates by entity_type (humans match humans, pets match pets)
        const filteredCandidates = candidates.filter(c => (c.entity_type || 'human') === entityType);
        if (filteredCandidates.length === 0) return null;

        let mag = 0;
        for (const val of descriptor) mag += val * val;
        mag = Math.sqrt(mag);
        const normalized = mag > 0 ? descriptor.map(v => v / mag) : descriptor;

        let bestMatch = null;
        let minDist = Infinity;



        for (const person of filteredCandidates) {
            // Check global centroid
            const globalCentroid = (person as any).descriptor || (person as any).mean;

            if (globalCentroid && globalCentroid.length === normalized.length) {
                const dist = this.calculateL2Distance(normalized, globalCentroid);
                if (dist < minDist) {
                    minDist = dist;
                    bestMatch = person;
                }
            }

            // Check Eras (Phase E)
            if (person.eras && person.eras.length > 0) {
                for (const era of person.eras) {
                    if (era.centroid && era.centroid.length === normalized.length) {
                        const dist = this.calculateL2Distance(normalized, era.centroid);
                        if (dist < minDist) {
                            minDist = dist; // If era matches better, use it
                            bestMatch = person; // Still matches the same person
                        }
                    }
                }
            }
        }

        const similarity = 1 / (1 + minDist);
        // Compare distance against threshold (lower distance = better match)
        if (bestMatch && minDist <= threshold) {
            return { personId: bestMatch.id, personName: bestMatch.name, distance: minDist, similarity };
        }
        return null;
    }

    // Public helper for other services
    static calculateL2Distance(v1: number[], v2: number[]): number {
        let sumSq = 0;
        for (let i = 0; i < v1.length; i++) {
            const diff = v1[i] - v2[i];
            sumSq += diff * diff;
        }
        return Math.sqrt(sumSq);
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

                    // Simple IOU Check
                    const interX1 = Math.max(f1.box.x, f2.box.x);
                    const interY1 = Math.max(f1.box.y, f2.box.y);
                    const interX2 = Math.min(f1.box.x + f1.box.width, f2.box.x + f2.box.width);
                    const interY2 = Math.min(f1.box.y + f1.box.height, f2.box.y + f2.box.height);
                    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
                    const unionArea = (f1.box.width * f1.box.height) + (f2.box.width * f2.box.height) - interArea;
                    const iou = unionArea > 0 ? interArea / unionArea : 0;

                    // [Phase 68] Centralized Config for Deduplication
                    const advancedSettings = ConfigService.getAdvancedFaceSettings();
                    const DEDUP_THRESHOLD = advancedSettings.dedupIoUThresh ?? 0.55;

                    if (iou > DEDUP_THRESHOLD) {
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
            try { db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?').run(width, height, photoId); } catch (e) { }
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
        const settings = getAISettings();
        const HIGH_THRESHOLD = settings.autoAssignThreshold || 0.7;     // L2 distance for auto-assign
        const REVIEW_THRESHOLD = settings.reviewThreshold || 0.9;       // L2 distance for review tier
        const SEARCH_CUTOFF = Math.max(REVIEW_THRESHOLD + 0.1, 1.0);    // Search a bit beyond review tier
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
                    const oldBox = oldFace.box;
                    const newBox = face.box;
                    const interX1 = Math.max(newBox.x, oldBox.x);
                    const interY1 = Math.max(newBox.y, oldBox.y);
                    const interX2 = Math.min(newBox.x + newBox.width, oldBox.x + oldBox.width);
                    const interY2 = Math.min(newBox.y + newBox.height, oldBox.y + oldBox.height);
                    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
                    const unionArea = (newBox.width * newBox.height) + (oldBox.width * oldBox.height) - interArea;
                    const iou = unionArea > 0 ? interArea / unionArea : 0;

                    // [Phase 68] Retroactive Hysteresis (Cleanup Existing Trash)
                    // Use Centralized Deduplication Threshold
                    const advancedSettings = ConfigService.getAdvancedFaceSettings();
                    const DEDUP_THRESHOLD = advancedSettings.dedupIoUThresh ?? 0.55;

                    if (iou > DEDUP_THRESHOLD && iou > maxIoU) {
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
                        const ignoredBox = ignoredFace.box;
                        const newBox = face.box;
                        const interX1 = Math.max(newBox.x, ignoredBox.x);
                        const interY1 = Math.max(newBox.y, ignoredBox.y);
                        const interX2 = Math.min(newBox.x + newBox.width, ignoredBox.x + ignoredBox.width);
                        const interY2 = Math.min(newBox.y + newBox.height, ignoredBox.y + ignoredBox.height);
                        const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
                        const newArea = newBox.width * newBox.height;
                        const ignoredArea = ignoredBox.width * ignoredBox.height;
                        const minArea = Math.min(newArea, ignoredArea);
                        const ioMin = minArea > 0 ? interArea / minArea : 0;

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


                    // Phase 5: Quality-Adjusted Thresholds
                    const fQuality = face.faceQuality ?? 0.5;
                    const adjHighThreshold = FaceAnalysisService.getQualityAdjustedThreshold(HIGH_THRESHOLD, fQuality);
                    const adjReviewThreshold = FaceAnalysisService.getQualityAdjustedThreshold(REVIEW_THRESHOLD, fQuality);

                    if (dist < adjHighThreshold) {
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
                    // [Phase 57] Determine entity_type based on detection score AND box characteristics
                    // Read threshold from settings (Centralized Config)
                    const settings = getAISettings();
                    const advancedSettings = ConfigService.getAdvancedFaceSettings(); // Contains strict floor

                    const vlmThreshold = settings.vlmVerificationThreshold ?? 0.85;
                    // FIX: Python returns 'score' (lowercase), use it directly
                    const detectionScore = face.score ?? 0.95;

                    // Check box characteristics for multi-face indicators
                    const box = face.box;
                    const boxWidth = box.width || 0;
                    const boxHeight = box.height || 0;
                    const aspectRatio = boxHeight > 0 ? boxWidth / boxHeight : 1.0;
                    const boxArea = boxWidth * boxHeight;

                    // Flag as suspect if:
                    // 1. Low detection score (< threshold)
                    // 2. Unusually large box (>4M pixels - likely contains multiple faces)
                    // 3. Unusual aspect ratio (>1.4 or <0.7 - may contain multiple faces)
                    const isLowScore = detectionScore < vlmThreshold;
                    const isLargeBox = boxArea > 4000000; // 2000x2000 pixels
                    const isUnusualAspect = aspectRatio > 1.6 || aspectRatio < 0.6;

                    // FIX: Ignore Python's entityType. Enforce local centralized thresholds.
                    const entityType = (isLowScore || isLargeBox || isUnusualAspect) ? 'suspect' : 'human';

                    if (isLargeBox || isUnusualAspect) {
                        logger.info(`[FaceService] Flagged face as suspect: ${isLargeBox ? `large box (${boxArea.toLocaleString()}px)` : ''} ${isUnusualAspect ? `unusual aspect (${aspectRatio.toFixed(2)})` : ''}`);
                    }

                    // [Safe Filter]: Strict Hysteresis
                    // 1. REJECT if score < STRICT_FLOOR (Loaded from ai-config.json via ConfigService)
                    // 2. QUEUE as 'suspect' if score floor - 0.85 (VLM Verification)
                    // 3. ACCEPT as 'human' if score > 0.85

                    // Default to 0.60 if config missing, but ConfigService should load from ai-config.json
                    const STRICT_FLOOR = advancedSettings.detThreshStandard ?? 0.60;

                    // [Phase 74 Fix] High-Quality Exception
                    const faceQuality = face.faceQuality ?? 0;
                    const HIGH_QUALITY_THRESHOLD = advancedSettings.highQualityFaceThreshold ?? 0.70;
                    const isHighQuality = faceQuality > HIGH_QUALITY_THRESHOLD;

                    // [Phase 79 Fix] Large Face Exception
                    // Python detector allows very large faces (>300px) even with low score.
                    // Electron must match this policy or we lose valid faces.
                    const LARGE_FACE_SIZE = advancedSettings.largeFaceThreshold ?? 300;
                    const isLargeWebSize = boxWidth > LARGE_FACE_SIZE || boxHeight > LARGE_FACE_SIZE;

                    if (detectionScore < STRICT_FLOOR && !isHighQuality && !isLargeWebSize) {
                        logger.info(`[FaceService] SKIPPING face ${faceIdx} - low score (Score: ${detectionScore.toFixed(2)} < ${STRICT_FLOOR}), low quality (${faceQuality.toFixed(2)}), and not large size.`);
                        continue;
                    }

                    if (detectionScore < STRICT_FLOOR && isLargeWebSize) {
                        logger.info(`[FaceService] LARGE FACE OVERRIDE for face ${faceIdx}: Score=${detectionScore.toFixed(2)} < ${STRICT_FLOOR} BUT Size > ${LARGE_FACE_SIZE}px. Keeping.`);
                    }

                    if (detectionScore < STRICT_FLOOR && isHighQuality) {
                        logger.info(`[FaceService] HIGH QUALITY OVERRIDE for face ${faceIdx}: Score=${detectionScore.toFixed(2)} < ${STRICT_FLOOR} BUT Quality=${faceQuality.toFixed(2)} > ${HIGH_QUALITY_THRESHOLD}. Keeping.`);
                    }

                    // Note: Faces between 0.65 and 0.85 will have entityType='suspect' (from VLM threshold)
                    // and will proceed to insertion below.


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
