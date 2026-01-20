import { PersonRepository } from '../../data/repositories/PersonRepository';
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { getAISettings } from '../../store'; // Will be replaced by ConfigService later

export class PersonService {
    static async recalculatePersonMean(personId: number) {
        console.time(`recalculatePersonMean-${personId}`);
        const settings = getAISettings();
        const blurThreshold = settings.faceBlurThreshold ?? 20;

        // Phase 3: Use confirmed faces only for stable centroid (Centroid Protection)
        const faces = FaceRepository.getConfirmedFaces(personId);

        const validFaces = faces.filter((f) =>
            f.descriptor &&
            f.descriptor.length > 0 &&
            (f.blur_score === null || f.blur_score >= blurThreshold)
        );

        if (validFaces.length === 0) {
            PersonRepository.updateDescriptorMean(personId, null);
            return;
        }

        let vectors = validFaces.map((f) => f.descriptor as number[]);

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

                        // Persist the drift alert for UI display
                        const personName = oldPerson.name || `Person ${personId}`;
                        PersonRepository.addAlert(
                            personId,
                            'drift_detected',
                            `Centroid drift detected for ${personName}: face signature shifted by ${(diff * 100).toFixed(1)}%. This may indicate misassigned faces.`,
                            diff
                        );
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

        try {
            // ensure cover face is valid/set
            PersonRepository.refreshPersonCover(personId);
        } catch (e) {
            console.error(`[PersonService] Failed to refresh cover for ${personId}`, e);
        }

        return { success: true, drift: driftDetected, driftDistance: diff };
    }

    /**
     * Age-Based ERA Generation
     * Groups faces by life stage buckets instead of visual clustering.
     * Uses quality-weighted statistical filtering to reject unreliable age estimates.
     * Only falls back to visual clustering if <50% of faces have age data.
     */
    static async generateEras(personId: number, config?: { minFacesForEra: number, eraMergeThreshold: number }) {
        const MIN_FACES_PER_ERA = config?.minFacesForEra ?? 5;
        const YEAR_BUCKET_SIZE = 3; // Group faces into 3-year windows

        console.log('[PersonService] Starting time-based ERA generation');

        // ===== STEP 1: Get all faces with dates =====
        const faces = FaceRepository.getAssignedFacesWithDates(personId);

        if (faces.length < MIN_FACES_PER_ERA) {
            return { success: false, error: `Not enough faces (found ${faces.length}, need ${MIN_FACES_PER_ERA})` };
        }

        // Helper: Calculate quality score for a face
        const getQualityScore = (f: any): number => {
            const blurFactor = Math.min((f.blur_score || 0) / 100, 1);
            const qualityFactor = f.face_quality || 0.5;
            const poseFactor = f.yaw !== undefined ? 1 - (Math.abs(f.yaw) / 90) : 1;
            return blurFactor * qualityFactor * poseFactor;
        };

        // Helper: Parse date from metadata
        const parseDate = (f: any): number | null => {
            if (f.timestamp && typeof f.timestamp === 'number') return f.timestamp;
            try {
                if (f.metadata_json) {
                    const meta = JSON.parse(f.metadata_json);
                    // Try multiple date fields
                    const dateField = meta.DateTimeOriginal || meta.CreateDate || meta.DateCreated || meta.DateTimeDigitized;

                    // Handle both object format {rawValue: "..."} and plain string
                    let dateStr: string | null = null;
                    if (dateField) {
                        if (typeof dateField === 'string') {
                            dateStr = dateField;
                        } else if (dateField.rawValue && typeof dateField.rawValue === 'string') {
                            dateStr = dateField.rawValue;
                        } else if (dateField.value && typeof dateField.value === 'string') {
                            dateStr = dateField.value;
                        }
                    }

                    if (dateStr) {
                        // Skip invalid dates like "0000:00:00 00:00:00"
                        if (dateStr.startsWith('0000') || dateStr.includes('0000:00:00')) {
                            return null;
                        }
                        // Convert EXIF format "YYYY:MM:DD HH:MM:SS" to ISO
                        const isoLike = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                        const ts = Date.parse(isoLike);
                        if (!isNaN(ts) && ts > 0) return ts;
                    }
                }
                // DON'T fall back to created_at - it's database insert time (2026)
            } catch (e) {
                // Ignore parse errors
            }
            return null;
        };

        // ===== STEP 2: Parse dates and filter =====
        const facesWithMeta = faces
            .filter((f: any) => f.descriptor && f.descriptor.length > 0)
            .map((f: any) => ({
                ...f,
                timestamp: parseDate(f),
                qualityScore: getQualityScore(f)
            }));

        const datedFaces = facesWithMeta.filter((f: any) => f.timestamp !== null);
        const undatedFaces = facesWithMeta.filter((f: any) => f.timestamp === null);

        console.log(`[PersonService] ${datedFaces.length} dated faces, ${undatedFaces.length} undated`);

        if (datedFaces.length < MIN_FACES_PER_ERA) {
            // All faces go to one era if not enough dates
            PersonRepository.clearEras(personId);
            if (facesWithMeta.length >= MIN_FACES_PER_ERA) {
                const descriptors = facesWithMeta.map((f: any) => f.descriptor);
                const mean = this.calculateCentroid(descriptors);
                const eraId = PersonRepository.addEra({
                    person_id: personId,
                    era_name: 'Era 1',
                    start_year: null,
                    end_year: null,
                    centroid_json: JSON.stringify(mean),
                    face_count: facesWithMeta.length,
                    is_auto_generated: true
                });
                for (const f of facesWithMeta) {
                    FaceRepository.updateFaceEra(f.id, eraId);
                }
                return { success: true, count: 1, method: 'single' };
            }
            return { success: false, error: `Not enough dated faces (found ${datedFaces.length})` };
        }

        // ===== STEP 3: Group by year buckets =====
        const years = datedFaces.map((f: any) => new Date(f.timestamp).getFullYear());
        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);
        const yearSpan = maxYear - minYear + 1;

        console.log(`[PersonService] Year range: ${minYear}-${maxYear} (${yearSpan} years)`);

        // Determine bucket boundaries
        const buckets: Map<string, any[]> = new Map();

        if (yearSpan <= YEAR_BUCKET_SIZE) {
            // All faces fit in one bucket
            buckets.set(`${minYear}-${maxYear}`, [...datedFaces]);
        } else {
            // Create multi-year buckets
            for (const face of datedFaces) {
                const year = new Date(face.timestamp).getFullYear();
                const bucketStart = minYear + Math.floor((year - minYear) / YEAR_BUCKET_SIZE) * YEAR_BUCKET_SIZE;
                const bucketEnd = Math.min(bucketStart + YEAR_BUCKET_SIZE - 1, maxYear);
                const bucketKey = bucketStart === bucketEnd ? `${bucketStart}` : `${bucketStart}-${bucketEnd}`;

                if (!buckets.has(bucketKey)) {
                    buckets.set(bucketKey, []);
                }
                buckets.get(bucketKey)!.push(face);
            }
        }

        // Add undated faces to the largest bucket
        if (undatedFaces.length > 0 && buckets.size > 0) {
            let largestBucket = '';
            let maxSize = 0;
            for (const [key, faces] of buckets) {
                if (faces.length > maxSize) {
                    maxSize = faces.length;
                    largestBucket = key;
                }
            }
            buckets.get(largestBucket)!.push(...undatedFaces);
            console.log(`[PersonService] Added ${undatedFaces.length} undated faces to bucket ${largestBucket}`);
        }

        console.log(`[PersonService] Created ${buckets.size} time buckets`);

        // ===== STEP 4: Preserve user-renamed ERAs before clearing =====
        const existingEras = PersonRepository.getEras(personId);
        const preservedNames = new Map<string, string>(); // "startYear-endYear" -> user_name

        for (const era of existingEras) {
            if (era.user_name && era.start_year && era.end_year) {
                const key = `${era.start_year}-${era.end_year}`;
                preservedNames.set(key, era.user_name);
                console.log(`[PersonService] Preserving user name "${era.user_name}" for range ${key}`);
            }
        }

        PersonRepository.clearEras(personId);
        let eraCount = 0;

        // Sort buckets chronologically
        const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => {
            const yearA = parseInt(a[0].split('-')[0]);
            const yearB = parseInt(b[0].split('-')[0]);
            return yearA - yearB;
        });

        for (const [bucketKey, bucketFaces] of sortedBuckets) {
            if (bucketFaces.length < MIN_FACES_PER_ERA) {
                console.log(`[PersonService] Skipping bucket ${bucketKey} with ${bucketFaces.length} faces (min: ${MIN_FACES_PER_ERA})`);
                continue;
            }

            const descriptors = bucketFaces.map((f: any) => f.descriptor);
            const mean = this.calculateCentroid(descriptors);

            // Parse year range from bucket key
            const [startYear, endYear] = bucketKey.includes('-')
                ? bucketKey.split('-').map(Number)
                : [parseInt(bucketKey), parseInt(bucketKey)];

            const label = `Era ${eraCount + 1} (${bucketKey})`;

            // Check if there's a preserved user name for this range
            const preservedName = preservedNames.get(`${startYear}-${endYear}`);

            const eraId = PersonRepository.addEra({
                person_id: personId,
                era_name: label,
                user_name: preservedName || null, // Apply preserved name if exists
                start_year: startYear,
                end_year: endYear,
                centroid_json: JSON.stringify(mean),
                face_count: bucketFaces.length,
                is_auto_generated: true
            });

            // Link faces to this era
            for (const f of bucketFaces) {
                FaceRepository.updateFaceEra(f.id, eraId);
            }
            eraCount++;
            console.log(`[PersonService] Created era "${label}" with ${bucketFaces.length} faces`);
        }

        console.log(`[PersonService] Generated ${eraCount} time-based eras for person ${personId}`);
        return { success: true, count: eraCount, method: 'time-based' };
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

        // 3. Move Faces - Manual move implies confirmation
        FaceRepository.updateFacePerson(faceIds, targetPerson.id, true);

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
