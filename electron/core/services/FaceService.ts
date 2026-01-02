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
        for (let i = 0; i < parsedDescriptors.length; i++) {
            const match = this.matchAgainstCentroids(parsedDescriptors[i], candidates, threshold);
            if (match) results[i] = { ...match, matchType: 'centroid' };
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
            if (!person.mean || person.mean.length !== normalized.length) continue;
            let sumSq = 0;
            for (let i = 0; i < normalized.length; i++) {
                const diff = normalized[i] - person.mean[i];
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

        db.transaction(() => {
            for (const face of faces) {
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

                let finalId = 0;
                let descriptorBuffer = null;
                if (face.descriptor && Array.isArray(face.descriptor)) {
                    descriptorBuffer = Buffer.from(new Float32Array(face.descriptor).buffer);
                }

                if (bestMatch) {
                    db.prepare('UPDATE faces SET descriptor = ?, box_json = ?, blur_score = ? WHERE id = ?')
                        .run(descriptorBuffer, JSON.stringify(face.box), face.blurScore, bestMatch.id);
                    finalId = bestMatch.id;
                } else {
                    const info = db.prepare(`
                        INSERT INTO faces (photo_id, person_id, descriptor, box_json, blur_score, is_reference)
                        VALUES (?, ?, ?, ?, ?, 0)
                     `).run(photoId, null, descriptorBuffer, JSON.stringify(face.box), face.blurScore);
                    finalId = Number(info.lastInsertRowid);
                }

                insertedIds.push(finalId);
                if (finalId > 0 && face.descriptor && face.descriptor.length > 0) {
                    facesForFaiss.push({ id: finalId, descriptor: face.descriptor });
                }
            }
        })();

        if (facesForFaiss.length > 0 && aiProvider) {
            aiProvider.addToIndex(facesForFaiss);
        }

        if (insertedIds.length > 0) {
            const settings = getAISettings();
            const res = await this.autoAssignFaces(insertedIds, settings.faceSimilarityThreshold, async (d, k, t) => aiProvider.searchFaces(d, k, t));
            if (res.success && typeof res.count === 'number' && res.count > 0) {
                logger.info(`[FaceService] Auto-assigned ${res.count} faces for photo ${photoId}`);
            }
        }
    }
}

type SearchFn = (descriptors: number[][], k?: number, threshold?: number) => Promise<{ id: number, distance: number }[][]>;
