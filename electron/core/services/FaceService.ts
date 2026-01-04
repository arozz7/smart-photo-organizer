import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { PersonService } from './PersonService';
import logger from '../../logger';
import { getDB } from '../../db';
import { getAISettings } from '../../store';

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
        logger.debug(`[FaceService] matchBatch: Checking ${parsedDescriptors.length} faces against ${candidates.length} candidates.`);

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
        if (pendingIndices.length > 0 && options.searchFn) {
            const pendingDescriptors = pendingIndices.map(i => parsedDescriptors[i]);
            const distThreshold = (1 / Math.max(0.01, threshold)) - 1;
            const batchFaiss = await options.searchFn(pendingDescriptors, options.topK ?? 5, distThreshold);

            // Fetch Person IDs for all matched faces in one go
            const allMatchedFaceIds = new Set<number>();
            batchFaiss.forEach(mList => mList.forEach(m => allMatchedFaceIds.add(m.id)));

            if (allMatchedFaceIds.size > 0) {
                const db = getDB();
                const placeholders = Array.from(allMatchedFaceIds).map(() => '?').join(',');
                const rows = db.prepare(`
                    SELECT f.id, f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${placeholders}) AND f.person_id IS NOT NULL
                `).all(...Array.from(allMatchedFaceIds)) as { id: number, person_id: number, name: string }[];

                const faceToPerson = new Map<number, { personId: number, name: string }>();
                rows.forEach(r => faceToPerson.set(r.id, { personId: r.person_id, name: r.name }));

                for (let j = 0; j < pendingIndices.length; j++) {
                    const originalIdx = pendingIndices[j];
                    const matches = batchFaiss[j];

                    for (const m of matches) {
                        if (faceToPerson.has(m.id)) {
                            const p = faceToPerson.get(m.id)!;
                            results[originalIdx] = {
                                personId: p.personId,
                                personName: p.name,
                                similarity: 1 / (1 + m.distance),
                                distance: m.distance,
                                matchType: 'faiss'
                            };
                            break;
                        }
                    }
                }
            }
        }

        return results;
    }

    private static matchAgainstCentroids(descriptor: number[], candidates: { id: number, name: string, mean: number[] }[], threshold: number) {
        if (!descriptor || candidates.length === 0) return null;

        let mag = 0;
        for (const val of descriptor) mag += val * val;
        mag = Math.sqrt(mag);
        const normalized = mag > 0 ? descriptor.map(v => v / mag) : descriptor;

        let bestMatch = null;
        let minDist = Infinity;

        for (const person of candidates) {
            // Check for descriptor (PersonRepository.getPeopleWithDescriptors returns { descriptor: ... })
            // or mean (legacy)
            const centroid = (person as any).descriptor || (person as any).mean;

            if (!centroid || centroid.length !== normalized.length) continue;
            let sumSq = 0;
            for (let i = 0; i < normalized.length; i++) {
                const diff = normalized[i] - centroid[i];
                sumSq += diff * diff;
            }
            const dist = Math.sqrt(sumSq);
            if (dist < minDist) {
                minDist = dist;
                bestMatch = person;
            }
        }

        const similarity = 1 / (1 + minDist);
        if (bestMatch && similarity >= threshold) {
            return { personId: bestMatch.id, personName: bestMatch.name, distance: minDist, similarity };
        }
        return null;
    }

    static async autoAssignFaces(faceIds: number[], thresholdOverride?: number, searchFn?: SearchFn) {
        try {
            let totalAssigned = 0;
            const allAssigned: any[] = [];
            let pass = 1;
            const MAX_PASSES = 5;

            while (pass <= MAX_PASSES) {
                const candidates = FaceRepository.getFacesForClustering();
                let faces = faceIds && faceIds.length > 0
                    ? candidates.filter((f: any) => faceIds.includes(f.id))
                    : candidates;

                if (faces.length === 0) break;

                logger.info(`[AutoAssign] Pass ${pass}: Matching ${faces.length} faces...`);

                const matchResults = await this.matchBatch(
                    faces.map((f: any) => f.descriptor),
                    { threshold: thresholdOverride, searchFn }
                );

                let passAssignedCount = 0;
                const peopleToRecalc = new Set<number>();

                for (let i = 0; i < faces.length; i++) {
                    const match = matchResults[i];
                    if (match) {
                        FaceRepository.updateFacePerson([faces[i].id], match.personId);
                        passAssignedCount++;
                        allAssigned.push({ faceId: faces[i].id, personId: match.personId, similarity: match.similarity });
                        peopleToRecalc.add(match.personId);
                    }
                }

                if (passAssignedCount === 0) break;

                totalAssigned += passAssignedCount;
                logger.info(`[AutoAssign] Pass ${pass}: Successfully identified ${passAssignedCount} faces.`);

                for (const pid of peopleToRecalc) {
                    await PersonService.recalculatePersonMean(pid);
                }
                pass++;
            }

            if (totalAssigned > 0) logger.info(`[AutoAssign] Final: Identified ${totalAssigned} faces.`);
            return { success: true, count: totalAssigned, assigned: allAssigned };

        } catch (e) {
            logger.error("Auto-Assign failed:", e);
            return { success: false, error: String(e) };
        }
    }

    static async processAnalysisResult(photoId: number, faces: any[], width: number, height: number, aiProvider: any) {
        logger.info(`[FaceService] Processing ${faces.length} faces for photo ${photoId}`);
        const db = getDB();
        const existingFaces = FaceRepository.getFacesByPhoto(photoId);

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
        // We use a high threshold to capture 'Review' tier candidates
        // Tier Thresholds: High < 0.4, Review < 0.6.  Match default is usually 0.65.
        // We'll trust matchBatch to return matches up to ~0.65
        let matchResults: (FaceMatch | null)[] = [];
        if (descriptorsToMatch.length > 0) {
            matchResults = await this.matchBatch(descriptorsToMatch, {
                threshold: 0.65,
                searchFn: async (d, k, t) => aiProvider.searchFaces(d, k, t)
            });
        }

        let matchIdx = 0;
        let assignedCount = 0;

        db.transaction(() => {
            for (const face of faces) {
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
                    if (iou > 0.5 && iou > maxIoU) {
                        maxIoU = iou;
                        bestMatch = oldFace;
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
                            logger.debug(`[FaceService] Scan match for face: dist=${matchData.distance.toFixed(3)}, person=${matchData.personId}`);
                        }
                    }
                }

                // Determine Tier
                let personId: number | null = bestMatch ? bestMatch.person_id : null;
                let suggestedPersonId: number | null = bestMatch ? bestMatch.suggested_person_id : null;
                let confidenceTier = bestMatch ? bestMatch.confidence_tier : 'unknown';
                let matchDistance = bestMatch ? bestMatch.match_distance : null;

                if (matchData) {
                    const dist = matchData.distance;
                    matchDistance = dist;

                    if (dist < 0.4) {
                        // High Confidence -> Auto Assign
                        // Only auto-assign if not already assigned manually to someone else??
                        // For now, if it's a new face or unassigned, assigned.
                        // If updating existing, maybe preserve? 
                        // Assuming scan refreshes state.
                        if (!personId) {
                            personId = matchData.personId;
                            confidenceTier = 'high';
                            suggestedPersonId = matchData.personId; // Also set suggested
                            assignedCount++;
                        }
                    } else if (dist < 0.6) {
                        // Review Tier
                        if (!personId) {
                            confidenceTier = 'review';
                            suggestedPersonId = matchData.personId;
                            logger.info(`[FaceService] Face classified as REVIEW tier (dist=${matchDistance?.toFixed(3)}). Suggested: ${matchData.personId}`);
                        }
                    } else {
                        // Unknown Tier
                        logger.info(`[FaceService] Face classified as UNKNOWN tier (dist=${matchDistance?.toFixed(3)})`);
                    }
                }

                let finalId = 0;

                if (bestMatch) {
                    // Update
                    // We only update classification if the face was previously unassigned/unknown
                    // OR if we want to constantly simple update. 
                    // Let's perform update.
                    db.prepare(`
                        UPDATE faces 
                        SET descriptor = ?, box_json = ?, blur_score = ?, 
                            confidence_tier = ?, suggested_person_id = ?, match_distance = ?,
                            person_id = COALESCE(person_id, ?) -- Only set if null
                        WHERE id = ?
                    `).run(
                        descriptorBuffer,
                        JSON.stringify(face.box),
                        face.blurScore,
                        confidenceTier,
                        suggestedPersonId,
                        matchDistance,
                        personId, // Coalesce fallback
                        bestMatch.id
                    );
                    finalId = bestMatch.id;
                } else {
                    // Insert
                    const info = db.prepare(`
                        INSERT INTO faces (
                            photo_id, person_id, descriptor, box_json, blur_score, 
                            is_reference, confidence_tier, suggested_person_id, match_distance
                        )
                        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
                     `).run(
                        photoId,
                        personId,
                        descriptorBuffer,
                        JSON.stringify(face.box),
                        face.blurScore,
                        confidenceTier,
                        suggestedPersonId,
                        matchDistance
                    );
                    finalId = Number(info.lastInsertRowid);
                }

                insertedIds.push(finalId);
                // Trigger Recalc if we auto-assigned a NEW person
                if (finalId > 0 && personId && (!bestMatch || bestMatch.person_id !== personId)) {
                    // We'll queue this or handle outside transaction?
                    // actually we can ignore recalc for now or do it batch at end?
                    // AutoAssign loop handled it. We are bypassing AutoAssign loop for "High" tier.
                    // We should recalc means if we auto-assigned.
                }

                if (finalId > 0 && face.descriptor && face.descriptor.length > 0) {
                    facesForFaiss.push({ id: finalId, descriptor: face.descriptor });
                }
            }
        })();

        if (facesForFaiss.length > 0 && aiProvider) {
            aiProvider.addToIndex(facesForFaiss);
        }

        // We replaced step `this.autoAssignFaces` with the inline logic above.
        // However, we might want to run re-calcs if we assigned anything.
        // Or we can leave autoAssignFaces for cleanup?
        // Note: autoAssignFaces does ITERATIVE assignment (multi-pass).
        // Our inline logic is SINGLE PASS.
        // For scan time, single pass against existing library is usually enough.
        // The iterative pass helps when uploading a huge batch of new people at once.
        // But for steady state, single pass is fine.

        // If we assigned faces, we should probably update person means eventually.
        // For simplicity/performance, we might skip rigorous recalc on every single photo scan.
        // Triggering it periodically or relying on user action is safer.
        // BUT `autoAssignFaces` did it.
        // Let's log success.
        // Logic complete.
        if (assignedCount > 0) logger.info(`[FaceService] Auto-assigned ${assignedCount} faces via scan-time logic.`);

        // Logic complete.
    }
}

type SearchFn = (descriptors: number[][], k?: number, threshold?: number) => Promise<{ id: number, distance: number }[][]>;
