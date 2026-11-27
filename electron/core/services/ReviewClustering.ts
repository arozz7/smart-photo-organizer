import { ClusterCache, clusterOptionsKey, type ClusterOptions } from './clusterCache';

export type ClusterParams = ClusterOptions;

export interface ClusterFace {
    id: number;
    descriptor: number[];
}

/** What the engine answers (and what the handler returns on): the clusters and singles, plus whatever else the engine added. */
export interface ClusterAnswer {
    clusters?: number[][];
    singles?: number[];
    error?: string;
    [other: string]: unknown;
}

export interface ReviewClusteringDeps {
    cache: ClusterCache;
    /** Asks the Python engine to cluster these faces (slow: minutes for a large library). */
    requestClustering(faces: ClusterFace[], params: ClusterParams): Promise<ClusterAnswer>;
}

/**
 * Groups the unassigned faces for Review Needed, asking the engine only when the remembered answer no longer fits (see `ClusterCache`).
 * An answer with an error, or without clusters, is passed on to the caller and not remembered.
 */
export async function clusterUnassignedFaces(faces: ClusterFace[], params: ClusterParams, deps: ReviewClusteringDeps): Promise<ClusterAnswer> {
    const key = clusterOptionsKey(params);
    const faceIds = faces.map(face => face.id);

    const remembered = deps.cache.lookup(faceIds, key);
    if (remembered) return { type: 'cluster_result', ...remembered, debug_info: null };

    const answer = await deps.requestClustering(faces, params);
    if (!answer.error && Array.isArray(answer.clusters)) {
        deps.cache.remember(faceIds, key, { clusters: answer.clusters, singles: answer.singles ?? [] });
    }
    return answer;
}
