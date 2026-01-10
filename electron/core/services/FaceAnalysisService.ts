/**
 * FaceAnalysisService.ts
 * 
 * Unified service for face analysis operations:
 * - Distance computation between face embeddings
 * - Multi-sample voting for challenging faces (Phase 5)
 * 
 * Note: Outlier detection and noise detection have been extracted to:
 * - FaceOutlierService.ts (findOutliersForPerson, IQR detection)
 * - FaceNoiseService.ts (detectBackgroundFaces)
 */

// Import services for use in deprecated proxy methods
import { FaceOutlierService } from './FaceOutlierService';
import { FaceNoiseService } from './FaceNoiseService';

// Re-export from extracted services for backward compatibility
export type { OutlierResult, OutlierAnalysis } from './FaceOutlierService';
export { FaceOutlierService } from './FaceOutlierService';
export type { NoiseCandidate, NoiseAnalysis } from './FaceNoiseService';
export { FaceNoiseService } from './FaceNoiseService';

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

    // =========================================================================
    // DEPRECATED METHODS - Use FaceOutlierService and FaceNoiseService directly
    // Kept here for backward compatibility with existing callers.
    // =========================================================================

    /**
     * @deprecated Use FaceOutlierService.findOutliersForPerson instead
     */
    static findOutliersForPerson(personId: number, threshold = 0.85) {
        // Import at top level via re-export, use directly
        return FaceOutlierService.findOutliersForPerson(personId, threshold);
    }

    /**
     * @deprecated Use FaceNoiseService.detectBackgroundFaces instead
     */
    static async detectBackgroundFaces(
        options: {
            minPhotoAppearances?: number;
            maxClusterSize?: number;
            centroidDistanceThreshold?: number;
        },
        pythonProvider: { sendRequest: (cmd: string, payload: any) => Promise<any> }
    ) {
        // Import at top level via re-export, use directly
        return FaceNoiseService.detectBackgroundFaces(options, pythonProvider);
    }
}

