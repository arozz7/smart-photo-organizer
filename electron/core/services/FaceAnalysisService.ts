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
     * Uses distance-to-centroid analysis to identify faces that don't match
     * the person's mean embedding.
     * 
     * @param personId The person ID to analyze
     * @param threshold Distance threshold above which faces are flagged (default: 1.0)
     *                  For L2-normalized embeddings: 0=identical, ~0.8=similar, ~1.2=different, 2=opposite
     * @returns Analysis result with outlier list
     */
    static findOutliersForPerson(personId: number, threshold = 1.2): OutlierAnalysis {
        // 1. Get person with centroid
        const person = PersonRepository.getPersonWithDescriptor(personId);

        if (!person) {
            throw new Error(`Person with ID ${personId} not found`);
        }

        const centroid = this.parseDescriptor(person.descriptor_mean_json);

        if (!centroid || centroid.length === 0) {
            return {
                personId,
                personName: person.name,
                totalFaces: 0,
                outliers: [],
                threshold,
                centroidValid: false
            };
        }

        // 2. Get all faces with descriptors for this person
        const faces = FaceRepository.getFacesWithDescriptorsByPerson(personId);

        // 3. Calculate distance for each face
        const outliers: OutlierResult[] = [];
        const allDistances: number[] = [];

        for (const face of faces) {
            const descriptor = this.parseDescriptor(face.descriptor);
            if (!descriptor) continue;

            const distance = this.computeDistance(descriptor, centroid);
            allDistances.push(distance);

            if (distance > threshold) {
                // Parse box JSON
                let box = { x: 0, y: 0, width: 100, height: 100 };
                try {
                    box = JSON.parse(face.box_json);
                } catch { /* use default */ }

                outliers.push({
                    faceId: face.id,
                    distance,
                    blurScore: face.blur_score,
                    box,
                    photo_id: face.photo_id, // Added
                    file_path: face.file_path,
                    preview_cache_path: face.preview_cache_path,
                    photo_width: face.width,
                    photo_height: face.height
                });
            }
        }

        // Debug logging for distance distribution
        if (allDistances.length > 0) {
            const sorted = [...allDistances].sort((a, b) => a - b);
            const min = sorted[0];
            const max = sorted[sorted.length - 1];
            const median = sorted[Math.floor(sorted.length / 2)];
            const avg = allDistances.reduce((a, b) => a + b, 0) / allDistances.length;
            console.log(`[FaceAnalysis] Person ${person.name}: ${faces.length} faces, distances min=${min.toFixed(3)} max=${max.toFixed(3)} avg=${avg.toFixed(3)} median=${median.toFixed(3)}, threshold=${threshold}, outliers=${outliers.length}`);
        }

        // 4. Sort by distance (worst first)
        outliers.sort((a, b) => b.distance - a.distance);

        return {
            personId,
            personName: person.name,
            totalFaces: faces.length,
            outliers,
            threshold,
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
}

