import { PersonRepository } from '../../data/repositories/PersonRepository';
import logger from '../../logger';
import { getDB } from '../../db';
import { getAISettings } from '../../store';
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

/** Finds which person a face descriptor belongs to: person centroids first, then the face search index. */
export class FaceMatcher {

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
            const faissResults = await options.searchFn([descArray], options.topK ?? 5, threshold * threshold); // FAISS reports squared L2

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
                    const distance = Math.sqrt(bestMatch?.distance ?? 0); // squared L2 from FAISS -> L2

                    return {
                        personId: rows[0].person_id,
                        personName: rows[0].name,
                        similarity: 1 / (1 + distance),
                        distance,
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
            // NOTE: FAISS compares/returns SQUARED L2; matchFace converts, this scan path does not (see aiChangeLog/fix-match-distance-setting.md)
            // A timeout/failure here must degrade to "no FAISS matches" rather
            // than aborting the whole batch — callers (e.g. per-photo scan
            // classification) must still complete so downstream state (queue
            // advancement, processing flags) doesn't get stuck.
            let batchFaiss: { id: number; distance: number }[][];
            try {
                batchFaiss = await options.searchFn(pendingDescriptors, options.topK ?? 5, threshold);
            } catch (e) {
                logger.error('[FaceService] matchBatch FAISS search failed:', e);
                return results;
            }

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

            // Check pose-specific centroids (Phase 105-3)
            // They compete alongside global centroid and eras — minimum distance wins
            if ((person as any).poseCentroids?.length > 0) {
                for (const poseCentroid of (person as any).poseCentroids) {
                    if (poseCentroid && poseCentroid.length === normalized.length) {
                        const dist = this.calculateL2Distance(normalized, poseCentroid);
                        if (dist < minDist) {
                            minDist = dist;
                            bestMatch = person;
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
}
