/**
 * FaceNoiseService.ts
 * 
 * Service for detecting background/noise faces for bulk ignore.
 * Extracted from FaceAnalysisService.ts for maintainability.
 */

import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { FaceAnalysisService } from './FaceAnalysisService';

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

export class FaceNoiseService {
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
        const people = PersonRepository.getPeopleWithDescriptors() as Array<{ id: number; name: string; descriptor: number[]; eras?: { name: string; centroid: number[] }[] }>;

        const centroids: { personId: number; name: string; descriptor: number[] }[] = [];

        for (const p of people) {
            // Main centroid
            if (p.descriptor && p.descriptor.length > 0) {
                centroids.push({
                    personId: p.id,
                    name: p.name,
                    descriptor: p.descriptor
                });
            }

            // Era centroids (flattened)
            if (p.eras && p.eras.length > 0) {
                for (const era of p.eras) {
                    if (era.centroid && era.centroid.length > 0) {
                        centroids.push({
                            personId: p.id,
                            name: era.name, // Use Era name for debugging/logging, but ID links it to person
                            descriptor: era.centroid
                        });
                    }
                }
            }
        }

        // 3. Transform faces for Python backend
        const facesPayload = unnamedFaces.map(f => ({
            id: f.id,
            descriptor: FaceAnalysisService.parseDescriptor(f.descriptor) || [],
            photo_id: f.photo_id,
            box_json: f.box_json,
            file_path: f.file_path,
            preview_cache_path: f.preview_cache_path,
            width: f.width,
            height: f.height
        })).filter(f => f.descriptor.length > 0);

        console.log(`[FaceNoise] detectBackgroundFaces: ${facesPayload.length} faces, ${centroids.length} centroids`);

        // 4. Call Python backend (with file-based transfer for large payloads)
        const LARGE_PAYLOAD_THRESHOLD = 5000;
        let result: any;

        if (facesPayload.length > LARGE_PAYLOAD_THRESHOLD) {
            // File-based transfer to avoid IPC timeout
            const fs = await import('fs/promises');
            const os = await import('os');
            const path = await import('path');

            const tempDir = os.tmpdir();
            const dataPath = path.join(tempDir, `spo_detect_bg_${Date.now()}.json`);

            console.log(`[FaceNoise] Large payload (${facesPayload.length} faces), using file-based transfer: ${dataPath}`);

            try {
                await fs.writeFile(dataPath, JSON.stringify({ faces: facesPayload, centroids }), 'utf-8');

                result = await pythonProvider.sendRequest('detect_background_faces', {
                    dataPath,
                    minPhotoAppearances: options.minPhotoAppearances ?? 3,
                    maxClusterSize: options.maxClusterSize ?? 2,
                    centroidDistanceThreshold: options.centroidDistanceThreshold ?? 0.7
                });
            } finally {
                // Cleanup temp file
                try {
                    await fs.unlink(dataPath);
                } catch { /* ignore cleanup errors */ }
            }
        } else {
            // Direct IPC for small payloads
            result = await pythonProvider.sendRequest('detect_background_faces', {
                faces: facesPayload,
                centroids,
                minPhotoAppearances: options.minPhotoAppearances ?? 3,
                maxClusterSize: options.maxClusterSize ?? 2,
                centroidDistanceThreshold: options.centroidDistanceThreshold ?? 0.7
            });
        }

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
