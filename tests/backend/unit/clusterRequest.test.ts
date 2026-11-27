import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { requestClusteringFromPython, LARGE_CLUSTER_THRESHOLD } from '../../../electron/infrastructure/ClusterRequest';

const params = { eps: 0.45, minSamples: 2, maxSize: 200, minCohesion: 0.6, maxSpread: 0.75 };
const facesOf = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, descriptor: [i] }));

describe('requestClusteringFromPython', () => {
    it('sends a small set of faces inside the request, with the engine\'s own setting names', async () => {
        const sendRequest = vi.fn(async () => ({ clusters: [] }));
        const faces = facesOf(3);

        await requestClusteringFromPython({ sendRequest }, faces, params);

        expect(sendRequest).toHaveBeenCalledWith('cluster_faces', { faces, eps: 0.45, min_samples: 2, max_size: 200, min_cohesion: 0.6, max_spread: 0.75 }, 900000);
    });

    it('sends a large set through a file, which holds every face while the engine reads it and is removed afterwards', async () => {
        let seen: { faces: { id: number }[] } | null = null;
        let path = '';
        const sendRequest = vi.fn(async (_type: string, payload: { dataPath?: string }) => {
            path = payload.dataPath!;
            seen = JSON.parse(fs.readFileSync(path, 'utf-8'));
            return { clusters: [[1, 2]] };
        });

        const answer = await requestClusteringFromPython({ sendRequest }, facesOf(LARGE_CLUSTER_THRESHOLD + 1), params);

        expect(answer).toEqual({ clusters: [[1, 2]] });
        expect(seen!.faces).toHaveLength(LARGE_CLUSTER_THRESHOLD + 1);
        expect(sendRequest.mock.calls[0][1]).toMatchObject({ eps: 0.45, min_samples: 2, max_size: 200, min_cohesion: 0.6, max_spread: 0.75 });
        expect(sendRequest.mock.calls[0][1]).not.toHaveProperty('faces');
        expect(fs.existsSync(path)).toBe(false);
    });

    it('removes the file even when the engine fails', async () => {
        let path = '';
        const sendRequest = vi.fn(async (_type: string, payload: { dataPath?: string }) => { path = payload.dataPath!; throw new Error('Timeout'); });

        await expect(requestClusteringFromPython({ sendRequest }, facesOf(LARGE_CLUSTER_THRESHOLD + 1), params)).rejects.toThrow('Timeout');

        expect(fs.existsSync(path)).toBe(false);
    });
});
