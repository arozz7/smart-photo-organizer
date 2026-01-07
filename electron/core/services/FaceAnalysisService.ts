/**
 * FaceAnalysisService.ts
 * 
 * Unified service for face analysis operations:
 * - Distance computation between face embeddings
 * - Outlier detection for misassigned faces
 * - Background face filtering (Phase 2)
 * - Multi-sample voting for challenging faces (Phase 5)
 */

import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';

export interface OutlierResult {
    faceId: number;
    distance: number;
    blurScore: number | null;
    // Face display data (so modal doesn't need to look up faces separately)
    box: { x: number; y: number; width: number; height: number };
    photo_id: number; // Added
    file_path: string;
    preview_cache_path: string | null;
    photo_width: number;
    photo_height: number;
}

export interface OutlierAnalysis {
    personId: number;
    personName: string;
    totalFaces: number;
    outliers: OutlierResult[];
    threshold: number;
    centroidValid: boolean;
}

/**
 * Candidate face identified as likely background noise.
 */
export interface NoiseCandidate {
    faceId: number;
    photoCount: number;
    clusterSize: number;
    nearestPersonDistance: number;
    nearestPersonName: string | null;
    // Display data
    box: { x: number; y: number; width: number; height: number };
    photo_id: number;
    file_path: string;
    preview_cache_path: string | null;
    photo_width: number;
    photo_height: number;
}

/**
 * Result of background face detection analysis.
 */
export interface NoiseAnalysis {
    candidates: NoiseCandidate[];
    stats: {
        totalUnnamed: number;
        singlePhotoCount: number;
        twoPhotoCount: number;
        noiseCount: number;
    };
}

export class FaceAnalysisService {
    /**
     * L2-normalize a vector (unit length).
     */
    static normalizeVector(vec: number[]): number[] {
        let magnitude = 0;
        for (let i = 0; i < vec.length; i++) {
            magnitude += vec[i] * vec[i];
        }
        magnitude = Math.sqrt(magnitude);

        if (magnitude === 0) return vec;

        return vec.map(v => v / magnitude);
    }

    /**
     * Compute Euclidean distance between two embeddings.
     * Both vectors are L2-normalized before comparison.
     * For normalized vectors: distance = sqrt(2 * (1 - cosine_similarity))
     * Range: 0 (identical) to 2 (opposite)
     * 
     * @param vecA First embedding vector
     * @param vecB Second embedding vector
     * @returns Euclidean distance between the two normalized vectors
     */
    static computeDistance(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length !== vecB.length) {
            return Infinity;
        }

        // Normalize both vectors to unit length
        const normA = this.normalizeVector(vecA);
        const normB = this.normalizeVector(vecB);

        let sum = 0;
        for (let i = 0; i < normA.length; i++) {
            const diff = normA[i] - normB[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    /**
     * Parse a descriptor from various formats (BLOB, JSON string, or array).
     * 
     * @param raw Raw descriptor data
     * @returns Parsed number array or null if invalid
     */
    static parseDescriptor(raw: unknown): number[] | null {
        if (!raw) return null;

        // Already an array
        if (Array.isArray(raw)) {
            return raw as number[];
        }

        // Buffer (BLOB from SQLite)
        if (Buffer.isBuffer(raw)) {
            try {
                const floatArray = new Float32Array(
                    raw.buffer,
                    raw.byteOffset,
                    raw.byteLength / 4
                );
                return Array.from(floatArray);
            } catch {
                return null;
            }
        }

        // JSON string
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        }

        return null;
    }

    /**
     * Find faces that are potential outliers (misassigned) for a given person.
     * 
     * DETECTION STRATEGY (Priority Order):
     * 1. REFERENCE-BASED (best): If user has confirmed faces, compute their mean
     *    as ground truth and flag faces that are too far from it.
     * 2. IQR FALLBACK: If no confirmed faces, use pairwise clustering IQR method.
     *    Note: IQR fails when contamination >50% (wrong faces become majority).
     * 
     * @param personId The person ID to analyze
     * @param threshold Distance threshold for reference-based (default 0.85)
     * @returns Analysis result with outlier list
     */
    static findOutliersForPerson(personId: number, threshold = 0.85): OutlierAnalysis {
        const person = PersonRepository.getPersonWithDescriptor(personId);

        if (!person) {
            throw new Error(`Person with ID ${personId} not found`);
        }

        const faces = FaceRepository.getFacesWithDescriptorsByPerson(personId);
        const confirmedFaces = FaceRepository.getConfirmedFaces(personId);
        const confirmedFaceIds = new Set(confirmedFaces.map(f => f.id));

        if (faces.length < 2) {
            return {
                personId,
                personName: person.name,
                totalFaces: faces.length,
                outliers: [],
                threshold,
                centroidValid: true
            };
        }

        // Parse all face descriptors
        const facesWithParsed = faces.map(f => ({
            ...f,
            parsedDescriptor: this.parseDescriptor(f.descriptor)
        })).filter(f => f.parsedDescriptor !== null);

        // STRATEGY 1: REFERENCE-BASED (using confirmed faces as ground truth)
        if (confirmedFaces.length >= 1) {
            console.log(`[FaceAnalysis] Person ${person.name}: Using REFERENCE-BASED detection with ${confirmedFaces.length} confirmed faces`);

            // Compute mean of confirmed faces as reference
            const confirmedDescriptors = confirmedFaces
                .map(f => this.parseDescriptor(f.descriptor))
                .filter(d => d !== null) as number[][];

            if (confirmedDescriptors.length === 0) {
                console.log(`[FaceAnalysis] No valid descriptors in confirmed faces, falling back to IQR`);
                return this.findOutliersIQR(personId, person, facesWithParsed, confirmedFaceIds, threshold);
            }

            // Compute reference centroid from confirmed faces only
            const refCentroid = new Array(confirmedDescriptors[0].length).fill(0);
            for (const desc of confirmedDescriptors) {
                for (let i = 0; i < desc.length; i++) {
                    refCentroid[i] += desc[i] / confirmedDescriptors.length;
                }
            }
            const normalizedRef = this.normalizeVector(refCentroid);

            // Find max distance among confirmed faces (to set adaptive threshold)
            let maxConfirmedDist = 0;
            for (const desc of confirmedDescriptors) {
                const dist = this.computeDistance(desc, normalizedRef);
                if (dist > maxConfirmedDist) maxConfirmedDist = dist;
            }

            // Adaptive threshold: max confirmed distance + margin
            // But CAP it at hard limit (e.g. 1.0) to prevent polluted confirmations from breaking detection.
            // A distance > 1.0 in Facenet/Dlib usually means completely different people.
            const calculatedThreshold = maxConfirmedDist + 0.25;
            const adaptiveThreshold = Math.min(1.0, Math.max(0.65, calculatedThreshold));

            console.log(`[FaceAnalysis] Confirmed faces max dist=${maxConfirmedDist.toFixed(3)}, calculated=${calculatedThreshold.toFixed(3)}, used=${adaptiveThreshold.toFixed(3)}`);

            // Flag faces far from reference
            const outliers: OutlierResult[] = [];
            for (const face of facesWithParsed) {
                if (confirmedFaceIds.has(face.id)) continue; // Skip confirmed

                const distance = this.computeDistance(face.parsedDescriptor!, normalizedRef);

                if (distance > adaptiveThreshold) {
                    let box = { x: 0, y: 0, width: 100, height: 100 };
                    try { box = JSON.parse(face.box_json); } catch { }

                    outliers.push({
                        faceId: face.id,
                        distance,
                        blurScore: face.blur_score,
                        box,
                        photo_id: face.photo_id,
                        file_path: face.file_path,
                        preview_cache_path: face.preview_cache_path,
                        photo_width: face.width,
                        photo_height: face.height
                    });
                }
            }

            console.log(`[FaceAnalysis] Person ${person.name}: Found ${outliers.length} outliers (REFERENCE method)`);
            outliers.sort((a, b) => b.distance - a.distance);

            return {
                personId,
                personName: person.name,
                totalFaces: faces.length,
                outliers,
                threshold: adaptiveThreshold,
                centroidValid: true
            };
        }

        // STRATEGY 2: IQR FALLBACK (no confirmed faces)
        console.log(`[FaceAnalysis] Person ${person.name}: No confirmed faces, using IQR method (may fail if >50% contaminated)`);
        return this.findOutliersIQR(personId, person, facesWithParsed, confirmedFaceIds, threshold);
    }

    /**
     * IQR-based outlier detection (fallback when no confirmed faces).
     * WARNING: This method fails when contamination exceeds ~50%.
     */
    private static findOutliersIQR(
        personId: number,
        person: { name: string },
        facesWithParsed: Array<any>,
        confirmedFaceIds: Set<number>,
        _threshold: number  // Kept for API parity, IQR uses dynamic threshold
    ): OutlierAnalysis {
        // Compute pairwise distances: avg distance of each face to all others
        const avgDistances: { faceId: number; avgDist: number; idx: number }[] = [];

        for (let i = 0; i < facesWithParsed.length; i++) {
            let totalDist = 0;
            let count = 0;

            for (let j = 0; j < facesWithParsed.length; j++) {
                if (i !== j) {
                    const dist = this.computeDistance(
                        facesWithParsed[i].parsedDescriptor!,
                        facesWithParsed[j].parsedDescriptor!
                    );
                    totalDist += dist;
                    count++;
                }
            }

            avgDistances.push({
                faceId: facesWithParsed[i].id,
                avgDist: count > 0 ? totalDist / count : 0,
                idx: i
            });
        }

        // IQR calculation
        const sortedDists = [...avgDistances].sort((a, b) => a.avgDist - b.avgDist);
        const q1Idx = Math.floor(sortedDists.length * 0.25);
        const q3Idx = Math.floor(sortedDists.length * 0.75);
        const q1 = sortedDists[q1Idx]?.avgDist ?? 0;
        const q3 = sortedDists[q3Idx]?.avgDist ?? 0;
        const iqr = q3 - q1;
        const outlierThreshold = q3 + (iqr * 1.0);

        console.log(`[FaceAnalysis] IQR: Q1=${q1.toFixed(3)}, Q3=${q3.toFixed(3)}, IQR=${iqr.toFixed(3)}, threshold=${outlierThreshold.toFixed(3)}`);

        const outliers: OutlierResult[] = [];
        for (const { faceId, avgDist, idx } of avgDistances) {
            if (confirmedFaceIds.has(faceId)) continue;

            if (avgDist > outlierThreshold) {
                const face = facesWithParsed[idx];
                let box = { x: 0, y: 0, width: 100, height: 100 };
                try { box = JSON.parse(face.box_json); } catch { }

                outliers.push({
                    faceId: face.id,
                    distance: avgDist,
                    blurScore: face.blur_score,
                    box,
                    photo_id: face.photo_id,
                    file_path: face.file_path,
                    preview_cache_path: face.preview_cache_path,
                    photo_width: face.width,
                    photo_height: face.height
                });
            }
        }

        console.log(`[FaceAnalysis] Found ${outliers.length} outliers (IQR method)`);
        outliers.sort((a, b) => b.distance - a.distance);

        return {
            personId,
            personName: person.name,
            totalFaces: facesWithParsed.length,
            outliers,
            threshold: outlierThreshold,
            centroidValid: true
        };
    }

    /**
     * Detect background/noise faces for bulk ignore.
     * Sends data to Python backend for DBSCAN clustering and centroid distance calculation.
     * 
     * @param options Threshold overrides from SmartIgnoreSettings
     * @param pythonProvider Python AI provider for backend calls
     */
    static async detectBackgroundFaces(
        options: {
            minPhotoAppearances?: number;
            maxClusterSize?: number;
            centroidDistanceThreshold?: number;
        },
        pythonProvider: { sendRequest: (cmd: string, payload: any) => Promise<any> }
    ): Promise<NoiseAnalysis> {
        // 1. Fetch unnamed faces with descriptors
        const unnamedFaces = FaceRepository.getUnnamedFacesForNoiseDetection();

        if (unnamedFaces.length === 0) {
            return {
                candidates: [],
                stats: { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 }
            };
        }

        // 2. Fetch named person centroids
        const people = PersonRepository.getPeopleWithDescriptors() as Array<{ id: number; name: string; descriptor: number[] }>;
        const centroids = people.map((p: { id: number; name: string; descriptor: number[] }) => ({
            personId: p.id,
            name: p.name,
            descriptor: p.descriptor
        })).filter((c: { personId: number; name: string; descriptor: number[] }) => c.descriptor.length > 0);

        // 3. Transform faces for Python backend
        const facesPayload = unnamedFaces.map(f => ({
            id: f.id,
            descriptor: this.parseDescriptor(f.descriptor) || [],
            photo_id: f.photo_id,
            box_json: f.box_json,
            file_path: f.file_path,
            preview_cache_path: f.preview_cache_path,
            width: f.width,
            height: f.height
        })).filter(f => f.descriptor.length > 0);

        console.log(`[FaceAnalysis] detectBackgroundFaces: ${facesPayload.length} faces, ${centroids.length} centroids`);

        // 4. Call Python backend
        const result = await pythonProvider.sendRequest('detect_background_faces', {
            faces: facesPayload,
            centroids,
            minPhotoAppearances: options.minPhotoAppearances ?? 3,
            maxClusterSize: options.maxClusterSize ?? 2,
            centroidDistanceThreshold: options.centroidDistanceThreshold ?? 0.7
        });

        if (!result.success && result.error) {
            throw new Error(result.error);
        }

        // 5. Transform results for frontend
        const candidates: NoiseCandidate[] = (result.candidates || []).map((c: any) => {
            let box = { x: 0, y: 0, width: 100, height: 100 };
            try {
                if (c.box_json) box = JSON.parse(c.box_json);
            } catch { /* use default */ }

            return {
                faceId: c.faceId,
                photoCount: c.photoCount,
                clusterSize: c.clusterSize,
                nearestPersonDistance: c.nearestPersonDistance,
                nearestPersonName: c.nearestPersonName,
                box,
                photo_id: c.photo_id,
                file_path: c.file_path,
                preview_cache_path: c.preview_cache_path,
                photo_width: c.width,
                photo_height: c.height
            };
        });

        return {
            candidates,
            stats: result.stats || { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 }
        };
    }

    /**
     * Quality-adjusted threshold for challenging faces (Phase 5).
     * Low quality faces (side profiles, occlusions) get a more relaxed threshold.
     * 
     * @param baseThreshold - Standard threshold (e.g., 0.6)
     * @param faceQuality - Quality score from 0-1 (from Python backend)
     * @returns Adjusted threshold
     */
    static getQualityAdjustedThreshold(baseThreshold: number, faceQuality: number): number {
        // Low quality (0.3) -> threshold + 0.15 = 0.75 (more relaxed)
        // High quality (0.9) -> threshold - 0.05 = 0.55 (more strict)
        const adjustment = (0.6 - faceQuality) * 0.25;
        return Math.max(0.3, Math.min(0.9, baseThreshold + adjustment));
    }

    /**
     * Determine the best match from a set of candidates using weighted voting.
     * Weights are inversely proportional to distance.
     */
    static consensusVoting(matches: { personId: number; distance: number }[]): { personId: number; confidence: number; distance: number } | null {
        if (!matches || matches.length === 0) return null;

        const votes = new Map<number, { count: number; weight: number; bestDist: number }>();

        for (const m of matches) {
            const entry = votes.get(m.personId) || { count: 0, weight: 0, bestDist: Infinity };
            // Weight formula: 1 / (1 + distance^2) -> Higher weight for close matches
            const w = 1 / (1 + m.distance * m.distance);

            votes.set(m.personId, {
                count: entry.count + 1,
                weight: entry.weight + w,
                bestDist: Math.min(entry.bestDist, m.distance)
            });
        }

        // Find winner
        let winnerId = -1;
        let maxWeight = -1;

        for (const [pid, stats] of votes.entries()) {
            // Boost weight for multiple occurrences
            const totalScore = stats.weight * (1 + Math.log(stats.count));

            if (totalScore > maxWeight) {
                maxWeight = totalScore;
                winnerId = pid;
            }
        }

        if (winnerId !== -1) {
            const stats = votes.get(winnerId)!;
            // Confidence is somewhat heuristic, based on weight ratio?
            // For now, return normalized weight or just 1.0
            return {
                personId: winnerId,
                confidence: maxWeight, // Raw score for now
                distance: stats.bestDist
            };
        }

        return null;
    }
}

