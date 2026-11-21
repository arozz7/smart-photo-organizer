/**
 * Pure logic of the "Turned faces" list (docs/plans/profile-suggestions-plan.md, Phase F1): which named person an unassigned
 * turned face resembles, judged by that person's confirmed turned faces ("examples"), not by the frontal centroid.
 * No database, no clock: descriptors in, suggestions out.
 */

export interface ProfileExample {
    faceId: number;
    personId: number;
    photoId: number;
    /** Unit length (see `unitVector`). */
    vector: Float32Array;
}

export interface ProfileCandidate {
    faceId: number;
    photoId: number;
    /** Unit length. */
    vector: Float32Array;
}

export interface PersonMatch {
    personId: number;
    /** L2 distance to the person's nearest example. */
    distance: number;
    /** The person's nearest examples to the face (up to two), nearest first, for the page to show beside it. */
    exampleFaceIds: number[];
}

export interface FaceSuggestion {
    faceId: number;
    photoId: number;
    /** One or two people, nearest first (two when examples of two people are both within the distance). */
    matches: PersonMatch[];
}

/** A face is shown with at most this many names. */
export const MAX_NAMES = 2;
const EXAMPLES_SHOWN = 2;

/** A stored descriptor scaled to length 1 (descriptors in the library are not all unit length), or null when it is unusable. */
export function unitVector(raw: ArrayLike<number>): Float32Array | null {
    if (raw.length === 0) return null;
    let sum = 0;
    for (let i = 0; i < raw.length; i++) {
        const value = raw[i];
        if (!Number.isFinite(value)) return null;
        sum += value * value;
    }
    if (sum === 0) return null;
    const norm = Math.sqrt(sum);
    const unit = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) unit[i] = raw[i] / norm;
    return unit;
}

function dot(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

/** L2 distance between two unit vectors. */
export function l2Distance(a: Float32Array, b: Float32Array): number {
    return Math.sqrt(Math.max(0, 2 - 2 * dot(a, b)));
}

interface PersonBest {
    personId: number;
    /** Best two (dot, face id) pairs, highest dot first. */
    best: { dot: number; faceId: number }[];
}

/** The examples of all people, searched for the ones nearest to a face. */
export class ProfileIndex {
    constructor(private readonly examples: readonly ProfileExample[]) {}

    get size(): number {
        return this.examples.length;
    }

    /**
     * The people (nearest first, at most MAX_NAMES) whose nearest example is within `maxDistance` of the face.
     * Examples from the face's own photo do not count; `isExcluded(personId)` removes a person (already in the photo,
     * or dismissed for this face).
     */
    find(candidate: ProfileCandidate, maxDistance: number, isExcluded: (personId: number) => boolean): PersonMatch[] {
        // distance <= d  <=>  dot >= 1 - d^2 / 2 for unit vectors
        const minDot = 1 - (maxDistance * maxDistance) / 2;
        const byPerson = new Map<number, PersonBest>();
        for (const example of this.examples) {
            if (example.photoId === candidate.photoId) continue;
            const similarity = dot(candidate.vector, example.vector);
            if (similarity < minDot) continue;
            let entry = byPerson.get(example.personId);
            if (!entry) {
                if (isExcluded(example.personId)) continue;
                entry = { personId: example.personId, best: [] };
                byPerson.set(example.personId, entry);
            }
            entry.best.push({ dot: similarity, faceId: example.faceId });
            entry.best.sort((a, b) => b.dot - a.dot);
            if (entry.best.length > EXAMPLES_SHOWN) entry.best.length = EXAMPLES_SHOWN;
        }
        return [...byPerson.values()]
            .map(entry => ({
                personId: entry.personId,
                distance: Math.sqrt(Math.max(0, 2 - 2 * entry.best[0].dot)),
                exampleFaceIds: entry.best.map(item => item.faceId),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, MAX_NAMES);
    }
}

/**
 * A person appears once in a photo, so a photo gives a person to only its nearest face: the others lose that name
 * (and fall back to their second name, if they have one). Returns the suggestions nearest first.
 */
export function resolvePerPhoto(found: readonly FaceSuggestion[]): FaceSuggestion[] {
    const ordered = [...found].sort((a, b) => a.matches[0].distance - b.matches[0].distance);
    const claimed = new Set<string>();
    const resolved: FaceSuggestion[] = [];
    for (const suggestion of ordered) {
        const free = suggestion.matches.filter(match => !claimed.has(`${suggestion.photoId}:${match.personId}`));
        if (free.length === 0) continue;
        claimed.add(`${suggestion.photoId}:${free[0].personId}`);
        resolved.push({ ...suggestion, matches: free });
    }
    return resolved.sort((a, b) => a.matches[0].distance - b.matches[0].distance);
}
