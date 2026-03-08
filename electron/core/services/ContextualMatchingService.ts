import { getDB } from '../../db';
import logger from '../../logger';

/**
 * Result of a contextual propagation pass.
 */
export interface PropagationResult {
    success: boolean;
    propagated: number;
    skipped: number;
    error?: string;
}

/**
 * Row returned from the context query.
 */
interface ContextFace {
    face_id: number;
    person_id: number | null;
    confidence_tier: string | null;
    blur_score: number | null;
    pose_yaw: number | null;
}

interface AnchorVote {
    person_id: number;
    count: number;
}

/**
 * ContextualMatchingService
 *
 * Propagates confirmed high-confidence face labels to nearby unrecognised
 * faces using temporal (same session / ±5 min window) and spatial (GPS
 * ≤100 m) context signals.  Only faces with NO person_id that also have a
 * challenging pose (|yaw| > 45°) or are blurry (blur_score < 40) are
 * eligible targets — these are precisely the faces that the centroid
 * matcher struggles with most.
 *
 * Design constraints:
 * - All DB access via `getDB()` — pure SQL, no ORM.
 * - Stateless static methods only (no service loop — use
 *   BackgroundPropagationService for that).
 * - Assignment tagged with `assignment_source = 'context_temporal'` or
 *   `'context_spatial'` so the UI can render a badge.
 */
export class ContextualMatchingService {

    /** Minimum fraction of anchor votes required to assign a label. */
    private static readonly CONSENSUS_THRESHOLD = 0.70;

    /** Temporal window around a photo (minutes). */
    private static readonly TEMPORAL_WINDOW_MIN = 5;

    /** Maximum GPS distance to consider a photo "nearby" (metres). */
    private static readonly SPATIAL_RADIUS_M = 100;

    /** Minimum blur_score for an anchor face to be trusted. */
    private static readonly ANCHOR_MIN_BLUR = 50;

    /** Maximum |yaw| for an anchor face to be trusted (frontal). */
    private static readonly ANCHOR_MAX_YAW = 30;

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------

    /**
     * Propagate labels to hard-pose / blurry faces in the same temporal
     * context as the given photo.
     */
    static propagateTemporalLabels(photoId: number): PropagationResult {
        try {
            const db = getDB();

            const photo = db.prepare(
                'SELECT id, session_folder, date_taken FROM photos WHERE id = ?'
            ).get(photoId) as { id: number; session_folder: string | null; date_taken: string | null } | undefined;

            if (!photo) return { success: false, propagated: 0, skipped: 0, error: 'Photo not found' };

            // Build temporal window clause
            const clauses: string[] = [];
            const params: (string | number)[] = [];

            if (photo.session_folder) {
                clauses.push('p.session_folder = ?');
                params.push(photo.session_folder);
            }

            if (photo.date_taken) {
                // SQLite datetime arithmetic: ±5 minutes
                clauses.push(`(p.date_taken BETWEEN datetime(?, '-${this.TEMPORAL_WINDOW_MIN} minutes') AND datetime(?, '+${this.TEMPORAL_WINDOW_MIN} minutes'))`);
                params.push(photo.date_taken, photo.date_taken);
            }

            if (clauses.length === 0) {
                return { success: true, propagated: 0, skipped: 0 };
            }

            const contextFaces = this.getContextFaces(db, clauses, params);
            const result = this.applyVoting(db, photoId, contextFaces, 'context_temporal');
            return result;
        } catch (err) {
            logger.error({ err, photoId }, '[ContextualMatching] propagateTemporalLabels failed');
            return { success: false, propagated: 0, skipped: 0, error: String(err) };
        }
    }

    /**
     * Propagate labels to hard-pose / blurry faces in the same GPS vicinity
     * as the given photo.
     */
    static propagateSpatialLabels(photoId: number): PropagationResult {
        try {
            const db = getDB();

            const photo = db.prepare(
                'SELECT id, gps_lat, gps_lon FROM photos WHERE id = ?'
            ).get(photoId) as { id: number; gps_lat: number | null; gps_lon: number | null } | undefined;

            if (!photo || photo.gps_lat == null || photo.gps_lon == null) {
                return { success: true, propagated: 0, skipped: 0 };
            }

            // Approximate degree deltas for the radius.
            // 1° latitude ≈ 111 km  →  100 m ≈ 0.0009°
            // 1° longitude varies; use the same delta as a conservative bound.
            const latDelta = this.SPATIAL_RADIUS_M / 111000;
            const lonDelta = this.SPATIAL_RADIUS_M / (111000 * Math.cos((photo.gps_lat * Math.PI) / 180));

            const clauses = [
                'p.gps_lat BETWEEN ? AND ?',
                'p.gps_lon BETWEEN ? AND ?',
            ];
            const params: (string | number)[] = [
                photo.gps_lat - latDelta,
                photo.gps_lat + latDelta,
                photo.gps_lon - lonDelta,
                photo.gps_lon + lonDelta,
            ];

            const contextFaces = this.getContextFaces(db, clauses, params);
            const result = this.applyVoting(db, photoId, contextFaces, 'context_spatial');
            return result;
        } catch (err) {
            logger.error({ err, photoId }, '[ContextualMatching] propagateSpatialLabels failed');
            return { success: false, propagated: 0, skipped: 0, error: String(err) };
        }
    }

    /**
     * Run both temporal and spatial propagation passes for every photo
     * in the library that has at least one unrecognised hard-pose face.
     * Returns cumulative totals.
     */
    static batchPropagateForLibrary(): PropagationResult {
        try {
            const db = getDB();

            // Only process photos that actually have eligible target faces
            const photos = db.prepare(`
                SELECT DISTINCT photo_id as id
                FROM faces
                WHERE person_id IS NULL
                  AND (ABS(pose_yaw) > 45 OR blur_score < 40)
                  AND is_ignored = 0
                ORDER BY photo_id
            `).all() as { id: number }[];

            let totalPropagated = 0;
            let totalSkipped = 0;

            for (const { id } of photos) {
                const r1 = this.propagateTemporalLabels(id);
                const r2 = this.propagateSpatialLabels(id);
                totalPropagated += r1.propagated + r2.propagated;
                totalSkipped += r1.skipped + r2.skipped;
            }

            logger.info(
                { photos: photos.length, totalPropagated, totalSkipped },
                '[ContextualMatching] batchPropagateForLibrary complete'
            );

            return { success: true, propagated: totalPropagated, skipped: totalSkipped };
        } catch (err) {
            logger.error({ err }, '[ContextualMatching] batchPropagateForLibrary failed');
            return { success: false, propagated: 0, skipped: 0, error: String(err) };
        }
    }

    // ---------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------

    /**
     * Fetch all faces (anchor + target) belonging to photos that match
     * the given context clauses.
     */
    private static getContextFaces(
        db: ReturnType<typeof getDB>,
        clauses: string[],
        params: (string | number)[]
    ): ContextFace[] {
        const whereClause = clauses.map(c => `(${c})`).join(' AND ');
        const rows = db.prepare(`
            SELECT
                f.id          AS face_id,
                f.person_id,
                f.confidence_tier,
                f.blur_score,
                f.pose_yaw
            FROM faces f
            JOIN photos p ON p.id = f.photo_id
            WHERE ${whereClause}
              AND f.is_ignored = 0
              AND f.descriptor IS NOT NULL
        `).all(...params) as ContextFace[];
        return rows;
    }

    /**
     * Given a pool of context faces:
     *  1. Collect "anchor" votes — confirmed faces that are frontal + sharp.
     *  2. If a single person achieves >= CONSENSUS_THRESHOLD of anchor votes,
     *     assign that person to all target faces in the *current* photo.
     *  3. Mark assignment_source accordingly.
     */
    private static applyVoting(
        db: ReturnType<typeof getDB>,
        photoId: number,
        contextFaces: ContextFace[],
        source: 'context_temporal' | 'context_spatial'
    ): PropagationResult {
        // Anchor faces: confirmed, sharp, frontal, from ANY photo in context
        const anchors = contextFaces.filter(f =>
            f.person_id !== null &&
            f.confidence_tier === 'high' &&
            (f.blur_score ?? 0) >= this.ANCHOR_MIN_BLUR &&
            Math.abs(f.pose_yaw ?? 90) <= this.ANCHOR_MAX_YAW
        );

        if (anchors.length === 0) return { success: true, propagated: 0, skipped: 0 };

        // Tally votes per person
        const tally = new Map<number, number>();
        for (const a of anchors) {
            tally.set(a.person_id!, (tally.get(a.person_id!) ?? 0) + 1);
        }

        // Find the leading candidate
        let bestPerson: number | null = null;
        let bestCount = 0;
        for (const [pid, count] of tally) {
            if (count > bestCount) { bestCount = count; bestPerson = pid; }
        }

        if (!bestPerson) return { success: true, propagated: 0, skipped: 0 };

        const ratio = bestCount / anchors.length;
        if (ratio < this.CONSENSUS_THRESHOLD) return { success: true, propagated: 0, skipped: 0 };

        // Target faces: unrecognised hard-pose or blurry in THIS photo specifically
        const targets = db.prepare(`
            SELECT id FROM faces
            WHERE photo_id = ?
              AND person_id IS NULL
              AND is_ignored = 0
              AND (ABS(pose_yaw) > 45 OR blur_score < 40)
        `).all(photoId) as { id: number }[];

        if (targets.length === 0) return { success: true, propagated: 0, skipped: 0 };

        const assignStmt = db.prepare(`
            UPDATE faces
            SET person_id = ?, assignment_source = ?, confidence_tier = 'propagated'
            WHERE id = ?
        `);

        const txn = db.transaction(() => {
            for (const { id } of targets) {
                assignStmt.run(bestPerson, source, id);
            }
        });
        txn();

        logger.info(
            { photoId, bestPerson, count: targets.length, ratio: ratio.toFixed(2), source },
            '[ContextualMatching] Labels propagated'
        );

        return { success: true, propagated: targets.length, skipped: 0 };
    }
}
