import { describe, it, expect } from 'vitest';
import { decideFaissSync, formatNamedFaceFingerprint, toIndexFaces, type FaissSyncInput } from '../../../../electron/core/services/faissSync';

const NOW = 1_000_000;

/** An idle app, a backend that answers, and an index that matches the named faces. Tests change one thing. */
const base: FaissSyncInput = {
    namedCount: 100,
    fingerprint: '100:5050:338350',
    previousFingerprint: '100:5050:338350',
    syncedFingerprint: '100:5050:338350',
    indexCount: 100,
    busy: false,
    nowMs: NOW,
    retryNotBeforeMs: 0,
};

describe('decideFaissSync', () => {
    it('does nothing when the index matches the named faces', () => {
        expect(decideFaissSync(base)).toBe('wait');
    });

    it('rebuilds when named faces exist but the index is empty (the situation on a library that was never rebuilt)', () => {
        expect(decideFaissSync({ ...base, indexCount: 0, syncedFingerprint: null })).toBe('rebuild');
    });

    it('rebuilds when faces were removed from people but are still in the index', () => {
        expect(decideFaissSync({ ...base, indexCount: 130 })).toBe('rebuild');
    });

    it('rebuilds when the set of named faces changed even though the counts still agree', () => {
        // One face swapped for another: same count, different members.
        expect(decideFaissSync({ ...base, fingerprint: '100:5051:340000', previousFingerprint: '100:5051:340000' })).toBe('rebuild');
    });

    it('records the current state without rebuilding when the counts agree and nothing was recorded yet (first run after an upgrade)', () => {
        expect(decideFaissSync({ ...base, syncedFingerprint: null })).toBe('record-in-sync');
    });

    it('does nothing for an empty library: no named faces and an empty index', () => {
        const empty = { ...base, namedCount: 0, fingerprint: '0:0:0', previousFingerprint: '0:0:0', syncedFingerprint: '0:0:0', indexCount: 0 };

        expect(decideFaissSync(empty)).toBe('wait');
    });

    it('waits while a scan or AI processing is running', () => {
        expect(decideFaissSync({ ...base, indexCount: 0, busy: true })).toBe('wait');
    });

    it('waits while the AI backend is not answering', () => {
        expect(decideFaissSync({ ...base, indexCount: null })).toBe('wait');
    });

    it('waits while the user is still naming faces (the named set changed since the last check)', () => {
        expect(decideFaissSync({ ...base, indexCount: 0, fingerprint: '120:7000:600000', previousFingerprint: '100:5050:338350' })).toBe('wait');
    });

    it('waits one check after the first look, so it never rebuilds in the middle of an edit', () => {
        expect(decideFaissSync({ ...base, indexCount: 0, previousFingerprint: null })).toBe('wait');
    });

    it('waits until the retry time after a failed rebuild', () => {
        expect(decideFaissSync({ ...base, indexCount: 0, retryNotBeforeMs: NOW + 1 })).toBe('wait');
        expect(decideFaissSync({ ...base, indexCount: 0, retryNotBeforeMs: NOW })).toBe('rebuild');
    });
});

describe('toIndexFaces', () => {
    it('pairs each descriptor with its face id, the shape the AI backend reads', () => {
        expect(toIndexFaces([[0.1, 0.2], [0.3, 0.4]], [7, 8])).toEqual([
            { id: 7, descriptor: [0.1, 0.2] },
            { id: 8, descriptor: [0.3, 0.4] },
        ]);
    });

    it('returns nothing when the lists do not line up, instead of pairing the wrong faces', () => {
        expect(toIndexFaces([[0.1]], [1, 2])).toEqual([]);
        expect(toIndexFaces(undefined as never, [1])).toEqual([]);
    });
});

describe('formatNamedFaceFingerprint', () => {
    it('joins the count and the two sums', () => {
        expect(formatNamedFaceFingerprint({ count: 3, idSum: 60, idSquareSum: 1400 })).toBe('3:60:1400');
    });
});
