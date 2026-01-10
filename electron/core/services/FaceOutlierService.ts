/**
 * FaceOutlierService.ts
 * 
 * Service for detecting outlier (misassigned) faces for a given person.
 * Extracted from FaceAnalysisService.ts for maintainability.
 */

import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { FaceAnalysisService } from './FaceAnalysisService';

export interface OutlierResult {
    faceId: number;
    distance: number;
    blurScore: number | null;
    is_confirmed: boolean; // For filtering unconfirmed faces in Review All modal
    // Face display data (so modal doesn't need to look up faces separately)
    box: { x: number; y: number; width: number; height: number };
    photo_id: number;
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

export class FaceOutlierService {
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
            parsedDescriptor: FaceAnalysisService.parseDescriptor(f.descriptor)
        })).filter(f => f.parsedDescriptor !== null);

        // STRATEGY 1: REFERENCE-BASED (using confirmed faces as ground truth)
        if (confirmedFaces.length >= 1) {
            console.log(`[FaceOutlier] Person ${person.name}: Using REFERENCE-BASED detection with ${confirmedFaces.length} confirmed faces`);

            // Compute mean of confirmed faces as reference
            const confirmedDescriptors = confirmedFaces
                .map(f => FaceAnalysisService.parseDescriptor(f.descriptor))
                .filter(d => d !== null) as number[][];

            if (confirmedDescriptors.length === 0) {
                console.log(`[FaceOutlier] No valid descriptors in confirmed faces, falling back to IQR`);
                return this.findOutliersIQR(personId, person, facesWithParsed, confirmedFaceIds, threshold);
            }

            // Compute reference centroid from confirmed faces only
            const refCentroid = new Array(confirmedDescriptors[0].length).fill(0);
            for (const desc of confirmedDescriptors) {
                for (let i = 0; i < desc.length; i++) {
                    refCentroid[i] += desc[i] / confirmedDescriptors.length;
                }
            }
            const normalizedRef = FaceAnalysisService.normalizeVector(refCentroid);

            // Find max distance among confirmed faces (to set adaptive threshold)
            let maxConfirmedDist = 0;
            for (const desc of confirmedDescriptors) {
                const dist = FaceAnalysisService.computeDistance(desc, normalizedRef);
                if (dist > maxConfirmedDist) maxConfirmedDist = dist;
            }

            // Adaptive threshold: max confirmed distance + margin
            // But CAP it at hard limit (e.g. 1.0) to prevent polluted confirmations from breaking detection.
            // A distance > 1.0 in Facenet/Dlib usually means completely different people.
            const calculatedThreshold = maxConfirmedDist + 0.25;
            const adaptiveThreshold = Math.min(1.0, Math.max(0.65, calculatedThreshold));

            console.log(`[FaceOutlier] Confirmed faces max dist=${maxConfirmedDist.toFixed(3)}, calculated=${calculatedThreshold.toFixed(3)}, used=${adaptiveThreshold.toFixed(3)}`);

            // Flag faces far from reference
            const outliers: OutlierResult[] = [];
            for (const face of facesWithParsed) {
                if (confirmedFaceIds.has(face.id)) continue; // Skip confirmed

                const distance = FaceAnalysisService.computeDistance(face.parsedDescriptor!, normalizedRef);

                if (distance > adaptiveThreshold) {
                    let box = { x: 0, y: 0, width: 100, height: 100 };
                    try { box = JSON.parse(face.box_json); } catch { }

                    outliers.push({
                        faceId: face.id,
                        distance,
                        blurScore: face.blur_score,
                        is_confirmed: face.is_confirmed === 1,
                        box,
                        photo_id: face.photo_id,
                        file_path: face.file_path,
                        preview_cache_path: face.preview_cache_path,
                        photo_width: face.width,
                        photo_height: face.height
                    });
                }
            }

            console.log(`[FaceOutlier] Person ${person.name}: Found ${outliers.length} outliers (REFERENCE method)`);
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
        console.log(`[FaceOutlier] Person ${person.name}: No confirmed faces, using IQR method (may fail if >50% contaminated)`);
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
                    const dist = FaceAnalysisService.computeDistance(
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

        console.log(`[FaceOutlier] IQR: Q1=${q1.toFixed(3)}, Q3=${q3.toFixed(3)}, IQR=${iqr.toFixed(3)}, threshold=${outlierThreshold.toFixed(3)}`);

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
                    is_confirmed: face.is_confirmed === 1,
                    box,
                    photo_id: face.photo_id,
                    file_path: face.file_path,
                    preview_cache_path: face.preview_cache_path,
                    photo_width: face.width,
                    photo_height: face.height
                });
            }
        }

        console.log(`[FaceOutlier] Found ${outliers.length} outliers (IQR method)`);
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
}
