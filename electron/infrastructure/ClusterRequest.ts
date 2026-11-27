import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClusterAnswer, ClusterFace, ClusterParams } from '../core/services/ReviewClustering';

/** Above this many faces the request goes through a file: one message with every descriptor is too long for a string (RangeError). */
export const LARGE_CLUSTER_THRESHOLD = 5000;
/** The grouping of a whole library can take several minutes. */
const CLUSTER_TIMEOUT_MS = 900_000;

interface RequestSender {
    sendRequest(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<ClusterAnswer>;
}

function engineSettings(params: ClusterParams) {
    return { eps: params.eps, min_samples: params.minSamples, max_size: params.maxSize, min_cohesion: params.minCohesion, max_spread: params.maxSpread };
}

function writeFacesFile(filePath: string, faces: ClusterFace[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
        stream.on('error', reject);
        stream.write('{"faces":[');
        faces.forEach((face, index) => {
            if (index > 0) stream.write(',');
            stream.write(JSON.stringify(face));
        });
        stream.write(']}');
        stream.end(() => resolve());
    });
}

/** Asks the Python engine to cluster the faces (see `cluster_faces` in `src/python/commands/clustering.py`). */
export async function requestClusteringFromPython(provider: RequestSender, faces: ClusterFace[], params: ClusterParams): Promise<ClusterAnswer> {
    if (faces.length <= LARGE_CLUSTER_THRESHOLD) {
        return provider.sendRequest('cluster_faces', { faces, ...engineSettings(params) }, CLUSTER_TIMEOUT_MS);
    }
    const dataPath = path.join(os.tmpdir(), `spo_cluster_${Date.now()}.json`);
    try {
        await writeFacesFile(dataPath, faces);
        return await provider.sendRequest('cluster_faces', { dataPath, ...engineSettings(params) }, CLUSTER_TIMEOUT_MS);
    } finally {
        try { await fsPromises.unlink(dataPath); } catch { /* already gone */ }
    }
}
