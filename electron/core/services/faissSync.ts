/**
 * When should the face search index (FAISS) be rebuilt?
 *
 * The index must hold exactly the faces that belong to named people. Faces get assigned to people in many places
 * (naming a group, auto-assign at scan time, propagation, merges), so instead of hooking each one the app compares
 * the real set of named faces with what the index holds and rebuilds when they differ.
 */

export interface NamedFaceFingerprint {
    count: number;
    /** Sum of the face ids. Together with the other two numbers it identifies the set, not just its size. */
    idSum: number;
    idSquareSum: number;
}

export function formatNamedFaceFingerprint(fingerprint: NamedFaceFingerprint): string {
    return `${fingerprint.count}:${fingerprint.idSum}:${fingerprint.idSquareSum}`;
}

/**
 * Pairs descriptors with face ids in the shape the AI backend's add_faces_to_vector_index reads.
 * Returns an empty list when the two lists do not line up.
 */
export function toIndexFaces(vectors: number[][], ids: number[]): { id: number; descriptor: number[] }[] {
    if (!Array.isArray(vectors) || !Array.isArray(ids) || vectors.length !== ids.length) return [];
    return ids.map((id, i) => ({ id, descriptor: vectors[i] }));
}

export interface FaissSyncInput {
    /** Number of faces assigned to people (what the index should hold). */
    namedCount: number;
    /** Fingerprint of the named-face set now. */
    fingerprint: string;
    /** Fingerprint at the previous check; null on the first check. */
    previousFingerprint: string | null;
    /** Fingerprint recorded after the last successful rebuild; null if never recorded. */
    syncedFingerprint: string | null;
    /** Number of vectors in the index, or null when the AI backend did not answer. */
    indexCount: number | null;
    /** A scan or AI processing is running. */
    busy: boolean;
    nowMs: number;
    /** Do not rebuild before this time (set after a failed rebuild). */
    retryNotBeforeMs: number;
}

export type FaissSyncDecision = 'wait' | 'record-in-sync' | 'rebuild';

export function decideFaissSync(input: FaissSyncInput): FaissSyncDecision {
    if (input.busy || input.indexCount === null || input.nowMs < input.retryNotBeforeMs) return 'wait';

    // Still changing (the user is naming faces): wait for a quiet check before doing any work.
    if (input.fingerprint !== input.previousFingerprint) return 'wait';

    const sizesAgree = input.indexCount === input.namedCount;
    const sameSetAsLastRebuild = input.syncedFingerprint === null || input.syncedFingerprint === input.fingerprint;
    if (sizesAgree && sameSetAsLastRebuild) {
        return input.syncedFingerprint === null ? 'record-in-sync' : 'wait';
    }
    return 'rebuild';
}
