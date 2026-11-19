import { createHash } from 'node:crypto';
import logger from '../../logger';
import {
    DEFAULT_PARKED_SETTINGS,
    assignShotIds,
    faceBoxArea,
    parkedSummaryCacheKey,
    summariseParked,
    type FaceMeasure,
    type ParkedSettings,
    type ParkedSummary,
    type UnassignedFingerprint,
} from './parkedFaces';

/** Length of a face descriptor (InsightFace embedding). */
const DESCRIPTOR_DIM = 512;
/** Faces measured per request, so the AI backend (which handles one request at a time) is never held for long. */
const DEFAULT_ROWS_PER_REQUEST = 8_000;

export interface UnassignedFace {
    id: number;
    /** Raw float32 descriptor bytes as stored in the database. */
    descriptor: Buffer;
    boxJson: string | null;
    blur: number | null;
    photoId: number;
    filePath: string | null;
    /** Capture time as stored (second resolution). */
    dateTaken: string | null;
}

export interface DataFilePaths {
    descriptorsPath: string;
    shotsPath: string;
}

export interface NeighbourCountsRequest {
    /** Raw float32 file holding every face's descriptor, one row per face. */
    dataPath: string;
    /** Raw int32 file with one shot label per face (faces with the same label are one shot). */
    shotsPath: string;
    dim: number;
    rowStart: number;
    rowEnd: number;
    distances: number[];
    duplicateDistance: number;
    centroids: number[][];
}

export interface NeighbourCountsResponse {
    /** One list per requested distance, one entry per requested row. */
    counts: number[][];
    /** Faces within the first distance that were left out as exact copies or the same shot. */
    excluded: number[];
    nearestCentroid: number[] | null;
    total: number;
}

/** Everything the service needs from outside, so it can be tested without a database or the AI backend. */
export interface ParkedFaceSummaryDeps {
    getFingerprint(): UnassignedFingerprint;
    loadFaces(): UnassignedFace[];
    /** Centroids of named people (overall, per era and per pose) that unassigned human faces are compared with. */
    getCentroids(): number[][];
    /** Writes the descriptors and shot labels to temporary files, runs `use` with their paths, and removes the files afterwards. */
    withDataFiles<T>(descriptors: Buffer[], shotIds: number[], use: (paths: DataFilePaths) => Promise<T>): Promise<T>;
    /** Asks the AI backend; null when it did not answer. */
    requestNeighbourCounts(request: NeighbourCountsRequest): Promise<NeighbourCountsResponse | null>;
    /** A scan or AI work is running: the summary waits for idle time. */
    isBusy(): boolean;
    readCache(): string | null;
    writeCache(value: string): void;
    now(): number;
}

export type ParkedSummaryResult =
    | { status: 'ready'; summary: ParkedSummary; computedAt: string; fromCache: boolean }
    /** Not computed because other work is running; `summary` is the last saved result, if any. */
    | { status: 'busy'; summary: ParkedSummary | null; computedAt?: string }
    /** Only asked for the saved result, and it is missing or out of date; `summary` is the last saved one, if any. */
    | { status: 'stale'; summary: ParkedSummary | null; computedAt?: string }
    | { status: 'failed'; error: string };

interface CachedSummary {
    key: string;
    computedAt: string;
    summary: ParkedSummary;
}

function parseCache(raw: string | null): CachedSummary | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<CachedSummary>;
        if (typeof parsed.key === 'string' && typeof parsed.computedAt === 'string' && parsed.summary && typeof parsed.summary === 'object') {
            return parsed as CachedSummary;
        }
    } catch {
        // an unreadable saved result is the same as none
    }
    return null;
}

/**
 * Measures the unassigned faces and summarises how many are worth reviewing and how many are parked (see parkedFaces.ts).
 *
 * Read-only: it changes no face. The result is saved and reused until the unassigned faces, the named people or the
 * thresholds change, because the measuring (every face against every other) takes tens of seconds on a large library.
 * It never runs while a scan or AI work is active, and stops between requests if such work starts.
 */
export class ParkedFaceSummaryService {
    private inFlight: Promise<ParkedSummaryResult> | null = null;

    constructor(
        private readonly deps: ParkedFaceSummaryDeps,
        private readonly settings: ParkedSettings = DEFAULT_PARKED_SETTINGS,
        private readonly rowsPerRequest: number = DEFAULT_ROWS_PER_REQUEST
    ) {}

    /**
     * `cachedOnly` never measures: it returns the saved result if it is current, otherwise 'stale' with the last saved
     * result (if any). Opening a page uses it so that nothing heavy starts until the user asks.
     */
    getSummary(options: { refresh?: boolean; cachedOnly?: boolean } = {}): Promise<ParkedSummaryResult> {
        if (options.cachedOnly) return Promise.resolve(this.readSaved());
        if (this.inFlight) return this.inFlight;
        const run = this.run(options.refresh === true).finally(() => {
            this.inFlight = null;
        });
        this.inFlight = run;
        return run;
    }

    private currentKey(centroids: number[][]): string {
        return parkedSummaryCacheKey(this.deps.getFingerprint(), hashCentroids(centroids), this.settings);
    }

    private readSaved(): ParkedSummaryResult {
        const saved = parseCache(this.deps.readCache());
        if (saved && saved.key === this.currentKey(this.deps.getCentroids())) {
            return { status: 'ready', summary: saved.summary, computedAt: saved.computedAt, fromCache: true };
        }
        return saved ? { status: 'stale', summary: saved.summary, computedAt: saved.computedAt } : { status: 'stale', summary: null };
    }

    private async run(refresh: boolean): Promise<ParkedSummaryResult> {
        const centroids = this.deps.getCentroids();
        const key = this.currentKey(centroids);
        const cached = parseCache(this.deps.readCache());

        if (!refresh && cached && cached.key === key) {
            return { status: 'ready', summary: cached.summary, computedAt: cached.computedAt, fromCache: true };
        }
        if (this.deps.isBusy()) return this.busyResult(cached);

        try {
            const measured = await this.measure(centroids);
            if (measured === 'busy') return this.busyResult(cached);

            const summary = summariseParked(measured, this.settings);
            const computedAt = new Date(this.deps.now()).toISOString();
            this.deps.writeCache(JSON.stringify({ key, computedAt, summary } satisfies CachedSummary));
            logger.info(
                `[ParkedFaces] ${summary.unassigned} unassigned faces: ${summary.worthReviewing} worth reviewing, ${summary.parked} parked ` +
                `(${summary.lowQuality} low quality, ${summary.singleton} appear once); ` +
                `${summary.nearNamed} lone faces kept because they are near a named person; ` +
                `${summary.sameShotOnly} have no twin apart from the same shot saved again; ` +
                `${summary.singletonAtAlternativeDistance} would appear once at distance ${this.settings.alternativeTwinDistance}`
            );
            return { status: 'ready', summary, computedAt, fromCache: false };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[ParkedFaces] Could not measure the unassigned faces: ${message}`);
            return { status: 'failed', error: message };
        }
    }

    private busyResult(cached: CachedSummary | null): ParkedSummaryResult {
        return cached ? { status: 'busy', summary: cached.summary, computedAt: cached.computedAt } : { status: 'busy', summary: null };
    }

    /** One measure per usable unassigned face; 'busy' if other work started part-way. Throws when the backend fails. */
    private async measure(centroids: number[][]): Promise<FaceMeasure[] | 'busy'> {
        const allFaces = this.deps.loadFaces();
        const faces = allFaces.filter(face => face.descriptor.byteLength === DESCRIPTOR_DIM * 4);
        if (faces.length < allFaces.length) {
            logger.warn(`[ParkedFaces] Skipped ${allFaces.length - faces.length} faces whose descriptor is not ${DESCRIPTOR_DIM} numbers long`);
        }
        if (faces.length === 0) return [];

        const distances = [this.settings.twinDistance, this.settings.alternativeTwinDistance];
        const shotIds = assignShotIds(faces);
        return this.deps.withDataFiles(faces.map(face => face.descriptor), shotIds, async ({ descriptorsPath, shotsPath }) => {
            const measures: FaceMeasure[] = [];
            for (let rowStart = 0; rowStart < faces.length; rowStart += this.rowsPerRequest) {
                if (this.deps.isBusy()) return 'busy';

                const rowEnd = Math.min(rowStart + this.rowsPerRequest, faces.length);
                const response = await this.deps.requestNeighbourCounts({
                    dataPath: descriptorsPath,
                    shotsPath,
                    dim: DESCRIPTOR_DIM,
                    rowStart,
                    rowEnd,
                    distances,
                    duplicateDistance: this.settings.duplicateDistance,
                    centroids,
                });
                const rows = rowEnd - rowStart;
                if (!response || !isCompleteAnswer(response, rows, distances.length, centroids.length > 0)) {
                    throw new Error('The AI backend did not return counts for every face');
                }

                for (let i = 0; i < rows; i++) {
                    const face = faces[rowStart + i];
                    measures.push({
                        area: faceBoxArea(face.boxJson),
                        blur: face.blur,
                        twins: response.counts[0][i],
                        twinsAtAlternative: response.counts[1][i],
                        sameShot: response.excluded[i],
                        nearestCentroid: response.nearestCentroid ? response.nearestCentroid[i] : null,
                    });
                }
            }
            return measures;
        });
    }
}

function isCompleteAnswer(response: NeighbourCountsResponse, rows: number, distanceCount: number, expectCentroids: boolean): boolean {
    if (!Array.isArray(response.counts) || response.counts.length !== distanceCount) return false;
    if (response.counts.some(list => !Array.isArray(list) || list.length !== rows)) return false;
    if (!Array.isArray(response.excluded) || response.excluded.length !== rows) return false;
    if (expectCentroids && (!Array.isArray(response.nearestCentroid) || response.nearestCentroid.length !== rows)) return false;
    return true;
}

function hashCentroids(centroids: number[][]): string {
    return createHash('sha1').update(JSON.stringify(centroids)).digest('hex');
}
