import { describe, it, expect, vi } from 'vitest';
import { clusterUnassignedFaces, type ClusterParams } from '../../../electron/core/services/ReviewClustering';
import { ClusterCache, type CachedClustering } from '../../../electron/core/services/clusterCache';

const params: ClusterParams = { eps: 0.45, minSamples: 2, maxSize: 200, minCohesion: 0.6, maxSpread: 0.75 };
const faces = [1, 2, 3, 4].map(id => ({ id, descriptor: [id] }));
const answer = { type: 'cluster_result', clusters: [[1, 2], [3, 4]], singles: [] as number[], debug_info: null };

function setup() {
    let stored: CachedClustering | null = null;
    const cache = new ClusterCache({ load: () => stored, save: entry => { stored = entry; } });
    const requestClustering = vi.fn(async () => structuredClone(answer));
    return { cache, requestClustering };
}

describe('clusterUnassignedFaces', () => {
    it('asks the engine on the first call and remembers the answer', async () => {
        const { cache, requestClustering } = setup();

        const first = await clusterUnassignedFaces(faces, params, { cache, requestClustering });

        expect(requestClustering).toHaveBeenCalledTimes(1);
        expect(requestClustering).toHaveBeenCalledWith(faces, params);
        expect(first.clusters).toEqual([[1, 2], [3, 4]]);
    });

    it('does not ask the engine again for the same faces', async () => {
        const { cache, requestClustering } = setup();
        await clusterUnassignedFaces(faces, params, { cache, requestClustering });

        const second = await clusterUnassignedFaces(faces, params, { cache, requestClustering });

        expect(requestClustering).toHaveBeenCalledTimes(1);
        expect(second.clusters).toEqual([[1, 2], [3, 4]]);
    });

    it('does not ask the engine when faces only left the list', async () => {
        const { cache, requestClustering } = setup();
        await clusterUnassignedFaces(faces, params, { cache, requestClustering });

        const later = await clusterUnassignedFaces(faces.filter(face => face.id !== 4), params, { cache, requestClustering });

        expect(requestClustering).toHaveBeenCalledTimes(1);
        expect(later).toMatchObject({ clusters: [[1, 2]], singles: [3] });
    });

    it('asks the engine again when a face is new', async () => {
        const { cache, requestClustering } = setup();
        await clusterUnassignedFaces(faces, params, { cache, requestClustering });

        await clusterUnassignedFaces([...faces, { id: 5, descriptor: [5] }], params, { cache, requestClustering });

        expect(requestClustering).toHaveBeenCalledTimes(2);
    });

    it('does not remember a failed answer, and lets the caller see it', async () => {
        const { cache } = setup();
        const failing = vi.fn(async () => ({ type: 'cluster_result', error: 'boom' }));

        const failed = await clusterUnassignedFaces(faces, params, { cache, requestClustering: failing });
        await clusterUnassignedFaces(faces, params, { cache, requestClustering: failing });

        expect(failed).toMatchObject({ error: 'boom' });
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('does not remember anything when the engine request throws', async () => {
        const { cache, requestClustering } = setup();
        requestClustering.mockRejectedValueOnce(new Error('Timeout'));

        await expect(clusterUnassignedFaces(faces, params, { cache, requestClustering })).rejects.toThrow('Timeout');
        await clusterUnassignedFaces(faces, params, { cache, requestClustering });

        expect(requestClustering).toHaveBeenCalledTimes(2);
    });
});
