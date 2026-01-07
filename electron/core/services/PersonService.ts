import { PersonRepository } from '../../data/repositories/PersonRepository';
import { FaceService } from './FaceService';
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { getAISettings } from '../../store'; // Will be replaced by ConfigService later

export class PersonService {
    static async recalculatePersonMean(personId: number) {
        console.time(`recalculatePersonMean-${personId}`);
        const settings = getAISettings();
        const blurThreshold = settings.faceBlurThreshold ?? 20;

        const faces = FaceRepository.getAllFaces(10000, 0, { personId }, true);

        const validFaces = faces.filter((f: any) =>
            f.descriptor &&
            f.descriptor.length > 0 &&
            (f.blur_score === null || f.blur_score >= blurThreshold)
        );

        if (validFaces.length === 0) {
            PersonRepository.updateDescriptorMean(personId, null);
            return;
        }

        let vectors = validFaces.map((f: any) => f.descriptor as number[]);

        // --- Robust Centroid Calculation ---
        // Helper to calculate normalized mean vector
        const calcMean = (vecs: number[][]) => {
            const dim = vecs[0].length;
            const mean = new Array(dim).fill(0);
            for (const vec of vecs) {
                for (let i = 0; i < dim; i++) mean[i] += vec[i];
            }
            // Normalize
            let mag = 0;
            for (let i = 0; i < dim; i++) {
                mean[i] /= vecs.length;
                mag += mean[i] ** 2;
            }
            mag = Math.sqrt(mag);
            if (mag > 0) {
                for (let i = 0; i < dim; i++) mean[i] /= mag;
            }
            return mean;
        };

        // Helper for L2 distance
        const l2Dist = (v1: number[], v2: number[]) => {
            let sum = 0;
            for (let i = 0; i < v1.length; i++) sum += (v1[i] - v2[i]) ** 2;
            return Math.sqrt(sum);
        };

        // Pass 1: Initial Mean
        let mean = calcMean(vectors);

        // Pass 2: Outlier Rejection (if enough samples)
        if (vectors.length > 5) {
            const dists = vectors.map((v: number[]) => l2Dist(v, mean));

            // Calculate stats
            const sumDist = dists.reduce((a: number, b: number) => a + b, 0);
            const avgDist = sumDist / dists.length;
            const variance = dists.reduce((a: number, b: number) => a + (b - avgDist) ** 2, 0) / dists.length;
            const stdDev = Math.sqrt(variance);

            // Filter outliers: Faces that are > 1.5 stdDevs away OR > 0.65 hard cap from center
            // This prevents "pollution" where bad matches extend the cluster
            const dynamicLimit = avgDist + (1.5 * stdDev);
            const hardLimit = 0.65;
            const limit = Math.min(dynamicLimit, hardLimit);

            const cleanVectors = vectors.filter((_: number[], i: number) => dists[i] <= limit);

            if (cleanVectors.length > 0 && cleanVectors.length < vectors.length) {
                console.log(`[PersonService] Outlier Rejection for Persona ${personId}: Removed ${vectors.length - cleanVectors.length} faces (Limit: ${limit.toFixed(3)})`);
                vectors = cleanVectors;
                // Recalculate mean from clean vectors
                mean = calcMean(vectors);
            }
        }
        // --- End Robust Calculation ---

        // --- End Robust Calculation ---

        // --- Phase D: Centroid Drift Detection & History ---
        const DRIFT_THRESHOLD = 0.20; // 0.20 distance shift is significant for a mean
        let driftDetected = false;
        let diff = 0;

        // Fetch OLD mean
        const oldPerson = PersonRepository.getPerson(personId);

        if (oldPerson && oldPerson.descriptor_mean_json) {
            try {
                const oldMean = JSON.parse(oldPerson.descriptor_mean_json);
                if (Array.isArray(oldMean) && oldMean.length === mean.length) {
                    diff = l2Dist(oldMean, mean);
                    console.log(`[DriftCheck] Person ${personId} centroid shift: ${diff.toFixed(6)} (Threshold: ${DRIFT_THRESHOLD})`);

                    if (diff > DRIFT_THRESHOLD) {
                        console.warn(`[DriftAlert] Person ${personId} centroid drifted by ${diff.toFixed(3)} (Threshold: ${DRIFT_THRESHOLD})`);
                        driftDetected = true;
                    }
                }
            } catch (e) { /* Invalid JSON, ignore */ }
        }

        console.timeEnd(`recalculatePersonMean-${personId}`);
        PersonRepository.updateDescriptorMean(personId, JSON.stringify(mean));

        // Save History Snapshot
        try {
            // We need to access DB directly for history, or add repository method. 
            // For now, importing getDB helper if possible, or using a raw SQL execution utility?
            // Actually, verify where getDB comes from. It's usually in '../../db'. 
            // But since we are inside Service, we should probably stick to Repositories.
            // I'll assume we can add `addPersonHistory` to PersonRepository later, 
            // but for this "agentic" flow, I will try to use the `getDB` pattern if available, or just add the SQL here if I can import it.
            // Looking at imports, `getDB` isn't imported. I should import it.
            // Wait, I can't easily add imports with `replace_file_content` without touching top of file.
            // I'll assume PersonRepository can handle this modification or I'll add the method to PersonRepository first.
            // Actually, let's just create `PersonRepository.addHistorySnapshot`.
            PersonRepository.addHistorySnapshot(personId, JSON.stringify(mean), vectors.length, driftDetected ? 'drift_detected' : 'recalc');
        } catch (e) {
            console.warn("Failed to save person history:", e);
        }

        return { success: true, drift: driftDetected, driftDistance: diff };
    }

    static async generateEras(personId: number, config?: { minFacesForEra: number, eraMergeThreshold: number }) {
        const MIN_FACES_PER_ERA = config?.minFacesForEra ?? 50;
        const MERGE_THRESHOLD = config?.eraMergeThreshold ?? 0.75;

        const faces = FaceRepository.getConfirmedFacesWithDates(personId);

        if (faces.length < MIN_FACES_PER_ERA) {
            return { success: false, error: `Not enough faces (found ${faces.length}, need ${MIN_FACES_PER_ERA})` };
        }

        // 0. Helper to parse date
        const parseDate = (f: any): number | null => {
            if (f.timestamp && typeof f.timestamp === 'number') return f.timestamp;
            try {
                // Try Metadata First (Exif)
                if (f.metadata_json) {
                    const meta = JSON.parse(f.metadata_json);
                    // Common Exif fields
                    const dateStr = meta.DateTimeOriginal || meta.CreateDate || meta.DateCreated || meta.DateTimeDigitized;
                    if (dateStr && typeof dateStr === 'string') {
                        // Fix Exif format YYYY:MM:DD HH:MM:SS -> YYYY-MM-DD HH:MM:SS
                        const isoLike = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                        const ts = Date.parse(isoLike);
                        if (!isNaN(ts)) return ts;
                    }
                    if (meta.created_at) { // Sometimes stored in meta?
                        const ts = Date.parse(meta.created_at);
                        if (!isNaN(ts)) return ts;
                    }
                }

                // Fallback to DB created_at (Scan time - unreliable for eras but better than nothing?)
                // Actually, if created_at is strictly scan time, it will cluster everything into "Now".
                // Better to skip if no Exif?
                // For now, let's include it but maybe we need a flag?
                // If the user has NO Exif data, eras are impossible anyway.
                if (f.created_at) {
                    const ts = new Date(f.created_at).getTime();
                    if (!isNaN(ts)) return ts;
                }
            } catch (e) {
                // Ignore parse errors
            }
            return null;
        };

        // 0. Parse Dates (Best Effort)
        const facesWithMeta = faces.map((f: any) => ({ ...f, timestamp: parseDate(f) }));

        // 2. Visual Clustering (K-Means)
        // We use visual clustering because dates are often unreliable.
        // Dynamic K: 1 to 3 based on variance? For now, try K=2 if count > 20, else K=1 (Global)

        let k = 1;
        if (faces.length >= MIN_FACES_PER_ERA) k = 2; // Dynamic split
        if (faces.length >= (MIN_FACES_PER_ERA * 5)) k = 3;

        // Simple K-Means
        let centroids = [];
        // Initialize centroids with random faces
        for (let i = 0; i < k; i++) {
            const idx = Math.floor(Math.random() * facesWithMeta.length);
            centroids.push(facesWithMeta[idx].descriptor!);
        }

        let clusters: any[][] = Array.from({ length: k }, () => []);
        let changed = true;
        let iter = 0;

        // Run K-Means (max 10 iterations)
        while (changed && iter < 10) {
            changed = false;
            iter++;
            // Clear clusters
            clusters = Array.from({ length: k }, () => []);

            // Assign faces to nearest centroid
            for (const face of facesWithMeta) {
                let minDist = Infinity;
                let clusterIdx = 0;
                for (let i = 0; i < k; i++) {
                    const dist = FaceService.calculateL2Distance(face.descriptor!, centroids[i]);
                    if (dist < minDist) {
                        minDist = dist;
                        clusterIdx = i;
                    }
                }
                clusters[clusterIdx].push(face);
            }

            // Recalculate centroids
            for (let i = 0; i < k; i++) {
                if (clusters[i].length === 0) continue;
                const newCentroid = this.calculateCentroid(clusters[i].map(f => f.descriptor!));
                // Check shift
                const shift = FaceService.calculateL2Distance(centroids[i], newCentroid);
                if (shift > 0.01) changed = true;
                centroids[i] = newCentroid;
            }
        }

        // 3. Merge Similar Clusters
        // If two clusters have centroids closer than threshold, merge them.
        let merged = true;
        while (merged) {
            merged = false;
            // Re-calculate centroids first
            const currentCentroids = clusters.map(c =>
                c.length > 0 ? this.calculateCentroid(c.map(f => f.descriptor!)) : []
            );

            for (let i = 0; i < clusters.length; i++) {
                if (clusters[i].length === 0) continue;
                for (let j = i + 1; j < clusters.length; j++) {
                    if (clusters[j].length === 0) continue;

                    const dist = FaceService.calculateL2Distance(currentCentroids[i], currentCentroids[j]);
                    console.log(`[box] Cluster ${i} vs ${j}: distance ${dist.toFixed(4)} (Threshold: ${MERGE_THRESHOLD})`);
                    if (dist < MERGE_THRESHOLD) { // CONFIRMED: Use config threshold
                        // Merge j into i
                        clusters[i] = [...clusters[i], ...clusters[j]];
                        clusters[j] = []; // Empty j
                        merged = true;
                        break; // Restart loop to handle new centroid
                    }
                }
                if (merged) break;
            }
        }

        // Filter small clusters
        const validClusters = clusters.filter(c => c.length >= MIN_FACES_PER_ERA);

        // Save Eras
        PersonRepository.clearEras(personId);
        let eraCount = 0;

        for (const cluster of validClusters) {
            const mean = this.calculateCentroid(cluster.map(f => f.descriptor!));

            // Determine Label (Date range if available, else generic)
            const datedFaces = cluster.filter(f => f.timestamp !== null).sort((a, b) => a.timestamp! - b.timestamp!);
            let label = `Visual Era ${eraCount + 1}`;
            let startYear = null;
            let endYear = null;

            if (datedFaces.length > 0) {
                const start = new Date(datedFaces[0].timestamp!).getFullYear();
                const end = new Date(datedFaces[datedFaces.length - 1].timestamp!).getFullYear();
                if (start === end) label = `${start}`;
                else label = `${start}-${end}`;
                startYear = start;
                endYear = end;
            }

            const eraId = PersonRepository.addEra({
                person_id: personId,
                era_name: label,
                start_year: startYear,
                end_year: endYear,
                centroid_json: JSON.stringify(mean),
                face_count: cluster.length,
                is_auto_generated: true
            });

            // Link faces to this Era
            for (const f of cluster) {
                FaceRepository.updateFaceEra(f.id, eraId);
            }
            eraCount++;
        }

        console.log(`[PersonService] Generated ${eraCount} visual eras for person ${personId} (K=${k})`);
        return { success: true, count: eraCount };
    }

    // Helper extracted from recalculatePersonMean
    private static calculateCentroid(vectors: number[][]) {
        const dim = vectors[0].length;
        const mean = new Array(dim).fill(0);
        for (const vec of vectors) {
            for (let i = 0; i < dim; i++) mean[i] += vec[i];
        }
        let mag = 0;
        for (let i = 0; i < dim; i++) {
            mean[i] /= vectors.length;
            mag += mean[i] ** 2;
        }
        mag = Math.sqrt(mag);
        if (mag > 0) {
            for (let i = 0; i < dim; i++) mean[i] /= mag;
        }
        return mean;
    }

    static async mergePeople(fromId: number, toId: number) {
        if (fromId === toId) return;

        // 1. Move faces
        const faces = FaceRepository.getAllFaces(10000, 0, { personId: fromId }, false);
        const faceIds = faces.map((f: any) => f.id);

        if (faceIds.length > 0) {
            FaceRepository.updateFacePerson(faceIds, toId, true);
        }

        // 2. Delete old person
        PersonRepository.deletePerson(fromId);

        // 3. Recalculate mean for target
        await this.recalculatePersonMean(toId);
    }

    static async recalculateAllMeans() {
        const people = PersonRepository.getPeople();
        console.log(`[PersonService] Recalculating means for ${people.length} people...`);
        for (const p of people) {
            await this.recalculatePersonMean(p.id);
        }
        console.log('[PersonService] Recalculation complete.');
        return { success: true, count: people.length };
    }

    static async assignPerson(faceId: number, personName: string) {
        const normalizedName = personName.trim();
        // Check if person exists
        let person = PersonRepository.getPersonByName(normalizedName);
        if (!person) {
            person = PersonRepository.createPerson(normalizedName);
        }

        // Face Update
        FaceRepository.updateFacePerson([faceId], person.id, true);

        // Recalc
        this.recalculatePersonMean(person.id);

        return { success: true, person };
    }

    /**
     * Move faces to a target person by name, handling creation if needed.
     * Recalculates means for both source(s) and target.
     */
    static async moveFacesToPerson(faceIds: number[], targetName: string) {
        if (faceIds.length === 0) return { success: true };

        const normalizedName = targetName.trim();

        // 1. Get/Create Target Person
        let targetPerson = PersonRepository.getPersonByName(normalizedName);
        if (!targetPerson) {
            targetPerson = PersonRepository.createPerson(normalizedName);
        }

        // 2. Identify Source Persons (for mean recalc)
        // We query the faces BEFORE moving them to knwow who they belonged to
        const faces = FaceRepository.getFacesByIds(faceIds);
        const sourcePersonIds = new Set<number>();
        for (const face of faces) {
            //@ts-ignore - face parse typing issue
            if (face.person_id && face.person_id !== targetPerson.id) {
                //@ts-ignore
                sourcePersonIds.add(face.person_id);
            }
        }

        // 3. Move Faces
        FaceRepository.updateFacePerson(faceIds, targetPerson.id);

        // 4. Recalculate Means
        // Target
        await this.recalculatePersonMean(targetPerson.id);

        // Sources
        for (const sourceId of sourcePersonIds) {
            await this.recalculatePersonMean(sourceId);
        }

        return { success: true, person: targetPerson };
    }

    static async renamePerson(personId: number, newName: string) {
        const existing = PersonRepository.getPersonByName(newName);
        if (existing && existing.id !== personId) {
            return this.mergePeople(personId, existing.id);
        } else {
            PersonRepository.updatePersonName(personId, newName);
            return { success: true, merged: false };
        }
    }

    static async unassignFaces(faceIds: number[]) {
        if (faceIds.length === 0) return;

        // 1. Identify Source Persons (for mean recalc)
        const faces = FaceRepository.getFacesByIds(faceIds);
        const sourcePersonIds = new Set<number>();
        for (const face of faces) {
            //@ts-ignore
            if (face.person_id) {
                //@ts-ignore
                sourcePersonIds.add(face.person_id);
            }
        }

        // 2. Unassign
        FaceRepository.updateFacePerson(faceIds, null as any);

        // 3. Recalculate Source Means
        for (const sourceId of sourcePersonIds) {
            await this.recalculatePersonMean(sourceId);
        }
    }
}
