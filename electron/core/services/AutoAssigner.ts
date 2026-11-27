import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { PersonService } from './PersonService';
import logger from '../../logger';
import { getAISettings } from '../../store';
import type { FaceMatch, MatchOptions } from './FaceMatcher';

export type SearchFn = (descriptors: number[][], k?: number, threshold?: number) => Promise<{ id: number, distance: number }[][]>;

/** How the assigner finds a person for each descriptor (injected, so it can be replaced in tests). */
export type BatchMatcher = (descriptors: any[], options?: MatchOptions) => Promise<(FaceMatch | null)[]>;

/** Bulk assignment of unassigned faces to named people. */
export class AutoAssigner {

    /**
     * Options for auto-assign operation.
     */
    static readonly AUTO_ASSIGN_DEFAULTS = {
        maxAssignmentsPerPerson: 50,   // Cap to prevent single person absorbing wrong faces
        tierFilter: ['high'] as string[], // Only assign high-confidence by default
        deferRecalculation: false,      // Recalc at end by default
        useFaissFallback: false         // Disable FAISS for bulk to prevent voting issues
    };

    /**
     * Auto-assign unassigned faces to named people.
     * 
     * CRITICAL FIXES (v0.5.1):
     * - Freeze centroids at start (no mid-batch recalculation)
     * - Filter by confidence tier (only 'high' by default)
     * - Cap assignments per person (prevent cascade absorption)
     * - Return queued/capped faces for user review
     */
    static async run(
        matchBatch: BatchMatcher,
        faceIds: number[],
        thresholdOverride?: number,
        searchFn?: SearchFn,
        options?: Partial<typeof AutoAssigner.AUTO_ASSIGN_DEFAULTS>
    ) {
        const opts = { ...this.AUTO_ASSIGN_DEFAULTS, ...options };
        const settings = getAISettings();

        // Thresholds for tier classification (L2 distance - lower is better)
        const HIGH_THRESHOLD = thresholdOverride ?? settings.autoAssignThreshold ?? 0.7;
        const REVIEW_THRESHOLD = settings.reviewThreshold || 0.9;

        try {
            // 1. FREEZE CENTROIDS at start - prevents cascade drift
            const frozenCentroids = PersonRepository.getPeopleWithDescriptors();
            logger.info(`[AutoAssign] Frozen ${frozenCentroids.length} person centroids for batch operation.`);

            // 2. Get faces to process
            const candidates = FaceRepository.getFacesForClustering();
            const faces = faceIds && faceIds.length > 0
                ? candidates.filter((f: any) => faceIds.includes(f.id))
                : candidates;

            if (faces.length === 0) {
                return { success: true, count: 0, assigned: [], queuedForReview: [], capped: [] };
            }

            logger.info(`[AutoAssign] Processing ${faces.length} faces against ${frozenCentroids.length} people...`);

            // 3. Match ALL faces in single pass against FROZEN centroids
            const matchResults = await matchBatch(
                faces.map((f: any) => f.descriptor),
                {
                    threshold: REVIEW_THRESHOLD, // Capture all candidates up to review tier
                    candidatePeople: frozenCentroids,
                    searchFn: opts.useFaissFallback ? searchFn : undefined
                }
            );

            // 4. Process matches with filtering
            const assigned: { faceId: number; personId: number; similarity: number; tier: string }[] = [];
            const queuedForReview: { faceId: number; personId: number; distance: number; personName: string }[] = [];
            const capped: { faceId: number; personId: number; reason: string }[] = [];
            const assignmentCounts = new Map<number, number>();
            const affectedPeople = new Set<number>();

            for (let i = 0; i < faces.length; i++) {
                const match = matchResults[i];
                if (!match) continue;

                const face = faces[i];
                const dist = match.distance;

                // Determine tier
                let tier = 'unknown';
                if (dist < HIGH_THRESHOLD) {
                    tier = 'high';
                } else if (dist < REVIEW_THRESHOLD) {
                    tier = 'review';
                }

                // Check tier filter
                if (!opts.tierFilter.includes(tier)) {
                    if (tier === 'review') {
                        queuedForReview.push({
                            faceId: face.id,
                            personId: match.personId,
                            distance: dist,
                            personName: match.personName
                        });
                    }
                    continue;
                }

                // Check per-person cap
                const currentCount = assignmentCounts.get(match.personId) ?? 0;
                if (currentCount >= opts.maxAssignmentsPerPerson) {
                    capped.push({
                        faceId: face.id,
                        personId: match.personId,
                        reason: `Exceeded ${opts.maxAssignmentsPerPerson} assignments for ${match.personName}`
                    });
                    continue;
                }

                // Assign!
                assigned.push({
                    faceId: face.id,
                    personId: match.personId,
                    similarity: match.similarity,
                    tier
                });
                assignmentCounts.set(match.personId, currentCount + 1);
                affectedPeople.add(match.personId);
            }

            // 5. Batch commit assignments
            if (assigned.length > 0) {
                // Group by person for efficient batch update
                const groupedByPerson = new Map<number, number[]>();
                for (const a of assigned) {
                    const existing = groupedByPerson.get(a.personId) || [];
                    existing.push(a.faceId);
                    groupedByPerson.set(a.personId, existing);
                }

                for (const [personId, faceIdList] of groupedByPerson) {
                    FaceRepository.updateFacePerson(faceIdList, personId);
                }
            }

            // 6. Recalculate means ONCE at end (not per-pass)
            if (!opts.deferRecalculation && affectedPeople.size > 0) {
                logger.info(`[AutoAssign] Recalculating means for ${affectedPeople.size} affected people...`);
                for (const pid of affectedPeople) {
                    await PersonService.recalculatePersonMean(pid);
                }
            }

            // 7. Log results
            logger.info(`[AutoAssign] Complete: ${assigned.length} assigned, ${queuedForReview.length} queued for review, ${capped.length} capped`);

            return {
                success: true,
                count: assigned.length,
                assigned,
                queuedForReview,
                capped,
                affectedPeople: Array.from(affectedPeople)
            };

        } catch (e) {
            logger.error("Auto-Assign failed:", e);
            return { success: false, error: String(e) };
        }
    }
}
