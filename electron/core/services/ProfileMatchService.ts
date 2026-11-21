import logger from '../../logger';
import type { ProfileAssignment, ProfileExampleRow, ProfileFaceRow, ProfileFaceTile, ProfilePair } from '../../data/repositories/ProfileMatchRepository';
import { MAX_NAMES, ProfileIndex, resolvePerPhoto, unitVector, type FaceSuggestion, type PersonMatch, type ProfileExample } from './ProfileSuggester';

const DISTANCE_KEY = 'profile_distance';
const MIN_YAW_KEY = 'profile_min_yaw';

/**
 * How close (L2, unit descriptors) a turned face must be to one of a person's turned faces to be suggested.
 * Measured on the user's labels (docs/measurements/profile-matching.md): up to 1.0, 63 of 63 suggestions were right;
 * from 1.0 to 1.1, 20 of 21 (the error was a sibling), so 1.1 is the widest setting.
 */
export const DEFAULT_DISTANCE = 1.0;
export const MIN_DISTANCE = 0.8;
export const MAX_DISTANCE = 1.1;
export const DISTANCE_CHOICES = [0.8, 0.9, 1.0, 1.1] as const;
/** Turned means |yaw| of at least this many degrees. Nothing below 40 was measured. */
export const DEFAULT_MIN_YAW = 40;
export const MIN_YAW_ALLOWED = 40;
export const MAX_YAW_ALLOWED = 70;

/** Faces compared per step, then the loop yields. Measured on the real library (430 examples): 100 faces took a median 40 ms (95th percentile 61 ms); 60 stay under the 50 ms budget. */
export const COMPUTE_STEP = 60;
export const MAX_PAGE_SIZE = 200;
export const MAX_PAIRS_PER_ACTION = 500;

export interface ProfileMatchDeps {
    loadExamples(minYaw: number): ProfileExampleRow[];
    countCandidates(minYaw: number): number;
    loadCandidates(afterId: number, limit: number, minYaw: number): ProfileFaceRow[];
    personsInPhotos(photoIds: readonly number[]): Map<number, Set<number>>;
    dismissedPairs(faceIds: readonly number[]): Set<string>;
    assign(items: readonly ProfileAssignment[], at: string): ProfilePair[];
    dismiss(items: readonly ProfileAssignment[], at: string): void;
    undo(faceIds: readonly number[]): ProfilePair[];
    countAssigned(): number;
    faceTiles(faceIds: readonly number[]): ProfileFaceTile[];
    personNames(personIds: readonly number[]): Map<number, string>;
    frontalReference(personId: number, excludePhotoId: number): number | null;
    /** Rebuilds a person's centroids after faces were added or removed. */
    recalculate(personId: number): Promise<void>;
    /** Changes whenever the set of named faces changes (any person, any page). */
    fingerprint(): string;
    readFlag(key: string): string | null;
    writeFlag(key: string, value: string): void;
    /** Lets the rest of the app run between two steps. */
    yieldToEventLoop(): Promise<void>;
    now(): string;
}

export interface PersonName {
    personId: number;
    name: string;
    distance: number;
}

export interface ProfileRow {
    faceId: number;
    photoId: number;
    tile: ProfileFaceTile;
    /** The nearest person. */
    person: PersonName;
    /** The second name, when examples of another person are within the distance too. */
    also: PersonName | null;
    /** The suggested person's nearest turned examples. */
    examples: ProfileFaceTile[];
    /** A sharp frontal face of the suggested person. */
    frontal: ProfileFaceTile | null;
}

export interface ProfileOverview {
    state: 'computing' | 'ready' | 'error';
    error?: string;
    /** Faces compared so far, out of all candidates (while computing). */
    checked: number;
    candidates: number;
    /** Turned confirmed faces of named people used as examples, and how many people they belong to. */
    examples: number;
    peopleWithExamples: number;
    /** Faces suggested, those of them with two names, and how many each person has (most first). */
    total: number;
    twoNames: number;
    byPerson: { personId: number; name: string; count: number }[];
    /** Faces this list assigned that are still with that person (Undo could return them). */
    assignedFromList: number;
    /** True after assigning: the examples grew, so a new search ("Refresh") may find more. */
    stale: boolean;
    settings: {
        distance: number;
        defaultDistance: number;
        minDistance: number;
        maxDistance: number;
        distanceChoices: readonly number[];
        minYaw: number;
        defaultMinYaw: number;
        minYawAllowed: number;
        maxYawAllowed: number;
    };
}

export interface PairRequest {
    faceId: number;
    personId: number;
}

interface Cache {
    key: string;
    suggestions: FaceSuggestion[];
    /** Suggestions ordered for the page (people with most first, nearest first); rebuilt after a change. */
    ordered: FaceSuggestion[] | null;
    examples: number;
    peopleWithExamples: number;
}

function toFloats(buffer: Buffer): Float32Array {
    // copy first: a database buffer may not be aligned for a Float32Array view
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return new Float32Array(bytes);
}

function toExample(row: ProfileExampleRow): ProfileExample | null {
    const vector = unitVector(toFloats(row.descriptor));
    return vector ? { faceId: row.faceId, personId: row.personId, photoId: row.photoId, vector } : null;
}

const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

/**
 * The "Turned faces" list (docs/plans/profile-suggestions-plan.md, Phase F1): unassigned turned faces with the person whose
 * turned faces they resemble. The search runs in small steps with a pause between them and is kept in memory; nothing is
 * assigned except what the user chooses, and the main process only accepts a person the face was suggested for.
 */
export class ProfileMatchService {
    private cache: Cache | null = null;
    private running: { key: string; generation: number; promise: Promise<void> } | null = null;
    private generation = 0;
    private progress = { checked: 0, total: 0 };
    private failed: { key: string; message: string } | null = null;
    private stale = false;

    constructor(private readonly deps: ProfileMatchDeps) {}

    // ---- settings ---------------------------------------------------------------------------------------------

    getDistance(): number {
        const stored = Number(this.deps.readFlag(DISTANCE_KEY));
        return this.deps.readFlag(DISTANCE_KEY) !== null && inRange(stored, MIN_DISTANCE, MAX_DISTANCE) ? stored : DEFAULT_DISTANCE;
    }

    getMinYaw(): number {
        const stored = Number(this.deps.readFlag(MIN_YAW_KEY));
        return this.deps.readFlag(MIN_YAW_KEY) !== null && inRange(stored, MIN_YAW_ALLOWED, MAX_YAW_ALLOWED) ? stored : DEFAULT_MIN_YAW;
    }

    /** Returns false (and changes nothing) outside MIN_DISTANCE to MAX_DISTANCE. */
    setDistance(distance: number): boolean {
        if (!inRange(distance, MIN_DISTANCE, MAX_DISTANCE)) return false;
        this.deps.writeFlag(DISTANCE_KEY, String(distance));
        return true;
    }

    /** Returns false (and changes nothing) outside MIN_YAW_ALLOWED to MAX_YAW_ALLOWED. */
    setMinYaw(degrees: number): boolean {
        if (!inRange(degrees, MIN_YAW_ALLOWED, MAX_YAW_ALLOWED)) return false;
        this.deps.writeFlag(MIN_YAW_KEY, String(degrees));
        return true;
    }

    // ---- overview and search ----------------------------------------------------------------------------------

    /** The counts. Starts a search when none is current (settings or the named faces changed), so call it again while it says "computing". */
    getOverview(): ProfileOverview {
        const key = this.currentKey();
        const current = this.cache?.key === key ? this.cache : null;
        if (!current && this.running?.key !== key && this.failed?.key !== key) this.start(key);

        const suggestions = current?.suggestions ?? [];
        const counts = new Map<number, number>();
        for (const suggestion of suggestions) counts.set(suggestion.matches[0].personId, (counts.get(suggestion.matches[0].personId) ?? 0) + 1);
        const names = this.deps.personNames([...counts.keys()]);
        const byPerson = [...counts.entries()]
            .map(([personId, count]) => ({ personId, name: names.get(personId) ?? `Person ${personId}`, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const failed = this.failed?.key === key ? this.failed : null;
        return {
            state: failed ? 'error' : current ? 'ready' : 'computing',
            ...(failed ? { error: failed.message } : {}),
            checked: current ? this.progress.total : this.progress.checked,
            candidates: this.progress.total,
            examples: this.cache?.examples ?? 0,
            peopleWithExamples: this.cache?.peopleWithExamples ?? 0,
            total: suggestions.length,
            twoNames: suggestions.filter(suggestion => suggestion.matches.length === MAX_NAMES).length,
            byPerson,
            assignedFromList: this.deps.countAssigned(),
            stale: this.stale,
            settings: {
                distance: this.getDistance(),
                defaultDistance: DEFAULT_DISTANCE,
                minDistance: MIN_DISTANCE,
                maxDistance: MAX_DISTANCE,
                distanceChoices: DISTANCE_CHOICES,
                minYaw: this.getMinYaw(),
                defaultMinYaw: DEFAULT_MIN_YAW,
                minYawAllowed: MIN_YAW_ALLOWED,
                maxYawAllowed: MAX_YAW_ALLOWED,
            },
        };
    }

    /** Resolves when the search under way (if any) has finished. */
    whenReady(): Promise<void> {
        return this.running?.promise ?? Promise.resolve();
    }

    /** Forgets the results; the next overview searches again (new faces from a scan, or a search that failed). */
    refresh(): void {
        this.invalidate();
        this.failed = null;
    }

    private currentKey(): string {
        return `${this.deps.fingerprint()}|${this.getDistance()}|${this.getMinYaw()}`;
    }

    private invalidate(): void {
        this.cache = null;
        this.running = null;
        this.generation++;
        this.stale = false;
    }

    private start(key: string): void {
        const generation = ++this.generation;
        this.stale = false;
        this.progress = { checked: 0, total: 0 };
        const promise = this.search(key, generation).finally(() => {
            if (this.running?.generation === generation) this.running = null;
        });
        this.running = { key, generation, promise };
    }

    private async search(key: string, generation: number): Promise<void> {
        const distance = this.getDistance();
        const minYaw = this.getMinYaw();
        try {
            // Two reads scan the whole faces table (about 0.3 s each on 92,000 faces), so the app gets a turn between them.
            this.progress.total = this.deps.countCandidates(minYaw);
            await this.deps.yieldToEventLoop();
            const examples = this.deps.loadExamples(minYaw).map(toExample).filter((example): example is ProfileExample => example !== null);
            const index = new ProfileIndex(examples);
            await this.deps.yieldToEventLoop(); // loading the examples is the longest single piece of work
            const found: FaceSuggestion[] = [];
            let afterId = 0;
            for (;;) {
                if (generation !== this.generation) return;
                const rows = this.deps.loadCandidates(afterId, COMPUTE_STEP, minYaw);
                if (rows.length === 0) break;
                afterId = rows[rows.length - 1].id;
                const inPhoto = this.deps.personsInPhotos([...new Set(rows.map(row => row.photoId))]);
                const dismissed = this.deps.dismissedPairs(rows.map(row => row.id));
                for (const row of rows) {
                    const vector = unitVector(toFloats(row.descriptor));
                    if (!vector) continue;
                    const present = inPhoto.get(row.photoId);
                    const matches = index.find({ faceId: row.id, photoId: row.photoId, vector }, distance, personId => (present?.has(personId) ?? false) || dismissed.has(`${row.id}:${personId}`));
                    if (matches.length > 0) found.push({ faceId: row.id, photoId: row.photoId, matches });
                }
                this.progress.checked += rows.length;
                await this.deps.yieldToEventLoop();
            }
            if (generation !== this.generation) return;
            this.cache = {
                key,
                suggestions: resolvePerPhoto(found),
                ordered: null,
                examples: examples.length,
                peopleWithExamples: new Set(examples.map(example => example.personId)).size,
            };
        } catch (error) {
            if (generation !== this.generation) return;
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[ProfileMatch] Search failed: ${message}`);
            this.failed = { key, message };
        }
    }

    // ---- the list ---------------------------------------------------------------------------------------------

    private ordered(cache: Cache): FaceSuggestion[] {
        if (cache.ordered) return cache.ordered;
        const counts = new Map<number, number>();
        for (const suggestion of cache.suggestions) counts.set(suggestion.matches[0].personId, (counts.get(suggestion.matches[0].personId) ?? 0) + 1);
        cache.ordered = [...cache.suggestions].sort((a, b) => {
            const personA = a.matches[0].personId;
            const personB = b.matches[0].personId;
            if (personA !== personB) return (counts.get(personB) ?? 0) - (counts.get(personA) ?? 0) || personA - personB;
            return a.matches[0].distance - b.matches[0].distance;
        });
        return cache.ordered;
    }

    /** A page of the suggestions (people with the most first, nearest first within a person); `personId` limits it to faces suggested for that person. */
    list(offset: number, limit: number, personId?: number): ProfileRow[] {
        const cache = this.cache?.key === this.currentKey() ? this.cache : null;
        if (!cache) return [];
        const all = this.ordered(cache).filter(suggestion => personId === undefined || suggestion.matches.some(match => match.personId === personId));
        const page = all.slice(offset, offset + limit);
        if (page.length === 0) return [];

        const personIds = new Set<number>();
        const faceIds = new Set<number>();
        const frontals = new Map<number, number | null>();
        for (const suggestion of page) {
            faceIds.add(suggestion.faceId);
            for (const match of suggestion.matches) personIds.add(match.personId);
            for (const exampleId of suggestion.matches[0].exampleFaceIds) faceIds.add(exampleId);
            const frontal = this.deps.frontalReference(suggestion.matches[0].personId, suggestion.photoId);
            frontals.set(suggestion.faceId, frontal);
            if (frontal !== null) faceIds.add(frontal);
        }
        const tiles = new Map(this.deps.faceTiles([...faceIds]).map(tile => [tile.faceId, tile]));
        const names = this.deps.personNames([...personIds]);
        const named = (match: PersonMatch): PersonName => ({ personId: match.personId, name: names.get(match.personId) ?? `Person ${match.personId}`, distance: match.distance });

        const rows: ProfileRow[] = [];
        for (const suggestion of page) {
            const tile = tiles.get(suggestion.faceId);
            if (!tile) continue;
            const [first, second] = suggestion.matches;
            const frontalId = frontals.get(suggestion.faceId) ?? null;
            rows.push({
                faceId: suggestion.faceId,
                photoId: suggestion.photoId,
                tile,
                person: named(first),
                also: second ? named(second) : null,
                examples: first.exampleFaceIds.map(id => tiles.get(id)).filter((example): example is ProfileFaceTile => example !== undefined),
                frontal: frontalId !== null ? tiles.get(frontalId) ?? null : null,
            });
        }
        return rows;
    }

    // ---- choices ----------------------------------------------------------------------------------------------

    /** The pairs that are still suggested (a face and one of its names), with the distance they were suggested at. */
    private validate(requests: readonly PairRequest[]): ProfileAssignment[] {
        const bySuggestion = new Map((this.cache?.suggestions ?? []).map(suggestion => [suggestion.faceId, suggestion]));
        const valid: ProfileAssignment[] = [];
        const seen = new Set<number>();
        for (const request of requests) {
            const match = bySuggestion.get(request.faceId)?.matches.find(item => item.personId === request.personId);
            if (!match || seen.has(request.faceId)) continue;
            seen.add(request.faceId);
            valid.push({ faceId: request.faceId, personId: request.personId, distance: match.distance });
        }
        return valid;
    }

    private dropFromCache(pairs: readonly ProfilePair[], alsoFromSamePhoto: boolean): void {
        if (!this.cache) return;
        const photoOf = new Map(this.cache.suggestions.map(suggestion => [suggestion.faceId, suggestion.photoId]));
        const gone = new Set(pairs.map(pair => pair.faceId));
        const photoPerson = new Set(pairs.map(pair => `${photoOf.get(pair.faceId)}:${pair.personId}`));
        const dismissed = new Set(pairs.map(pair => `${pair.faceId}:${pair.personId}`));
        const next: FaceSuggestion[] = [];
        for (const suggestion of this.cache.suggestions) {
            if (alsoFromSamePhoto && gone.has(suggestion.faceId)) continue;
            const matches = suggestion.matches.filter(match =>
                !dismissed.has(`${suggestion.faceId}:${match.personId}`) && !(alsoFromSamePhoto && photoPerson.has(`${suggestion.photoId}:${match.personId}`)));
            if (matches.length > 0) next.push({ ...suggestion, matches });
        }
        this.cache = { ...this.cache, suggestions: next, ordered: null };
    }

    /** Gives faces to the people they were suggested for (confirmed), then rebuilds those people's centroids. Anything not suggested is skipped. */
    async assign(requests: readonly PairRequest[]): Promise<{ assigned: ProfilePair[]; skipped: number }> {
        const valid = this.validate(requests);
        const assigned = valid.length > 0 ? this.deps.assign(valid, this.deps.now()) : [];
        if (assigned.length > 0) {
            this.dropFromCache(assigned, true);
            if (this.cache) this.cache.key = this.currentKey();
            this.stale = true;
            await this.rebuild(assigned.map(pair => pair.personId));
        }
        return { assigned, skipped: requests.length - assigned.length };
    }

    /** "Not this person": remembered, so the pair is not suggested again; the face stays under its other name, if it has one. */
    async dismiss(requests: readonly PairRequest[]): Promise<{ dismissed: number; skipped: number }> {
        const valid = this.validate(requests);
        if (valid.length > 0) {
            this.deps.dismiss(valid, this.deps.now());
            this.dropFromCache(valid, false);
        }
        return { dismissed: valid.length, skipped: requests.length - valid.length };
    }

    /** Returns faces this list assigned to unassigned, rebuilds the people they came back from, and searches again. */
    async undo(faceIds: readonly number[]): Promise<{ restored: ProfilePair[] }> {
        const restored = this.deps.undo(faceIds);
        if (restored.length > 0) {
            this.invalidate();
            await this.rebuild(restored.map(pair => pair.personId));
        }
        return { restored };
    }

    private async rebuild(personIds: readonly number[]): Promise<void> {
        for (const personId of new Set(personIds)) {
            try {
                await this.deps.recalculate(personId);
            } catch (error) {
                logger.error(`[ProfileMatch] Could not rebuild the centroids of person ${personId}: ${String(error)}`);
            }
        }
    }
}
