/**
 * Review Needed groups every unassigned face (about 90,000 on a large library) into clusters in the Python engine, which takes minutes. Opening the
 * People page asked again every time, even when nothing had changed. This remembers the last answer and gives it back while it still fits.
 *
 * It fits when the settings are the same and no face is new. Faces that left the list (assigned, ignored) are simply taken out of the clusters;
 * a cluster left with fewer than two faces is no cluster, so its face becomes a single. A face the cache has never seen needs real clustering.
 */

/** Bump when the grouping itself changes (for example how an oversized cluster is split), so old answers are not reused. */
export const CLUSTER_ALGORITHM_VERSION = 2; // 2: oversized clusters are split with k-means instead of Ward linkage

export interface ClusterOptions {
    eps: number;
    minSamples: number;
    maxSize: number;
    minCohesion: number;
    maxSpread: number;
}

/** What identifies one grouping apart from its faces: the algorithm version and every setting that changes the result. */
export function clusterOptionsKey(options: ClusterOptions): string {
    return `v${CLUSTER_ALGORITHM_VERSION}|eps=${options.eps.toFixed(4)}|min=${options.minSamples}|max=${options.maxSize}|coh=${options.minCohesion}|spread=${options.maxSpread}`;
}

export interface ClusterGroups {
    clusters: number[][];
    singles: number[];
}

export interface CachedClustering extends ClusterGroups {
    optionsKey: string;
    faceIds: number[];
}

/** Where the remembered answer lives (a file in production, memory in tests). Failing to load or save must not throw. */
export interface ClusterCacheStore {
    load(): CachedClustering | null;
    save(entry: CachedClustering): void;
}

const DEFAULT_MIN_CLUSTER_SIZE = 2;

export class ClusterCache {
    private entry: CachedClustering | null | undefined;

    constructor(
        private readonly store: ClusterCacheStore,
        private readonly minClusterSize = DEFAULT_MIN_CLUSTER_SIZE,
    ) {}

    /** The clusters for these faces, or null when they need to be clustered. The answer is a copy. */
    lookup(faceIds: readonly number[], optionsKey: string): ClusterGroups | null {
        const entry = this.current();
        if (!entry || entry.optionsKey !== optionsKey) return null;

        const remembered = new Set(entry.faceIds);
        if (faceIds.some(id => !remembered.has(id))) return null;

        const present = new Set(faceIds);
        if (present.size === remembered.size) return { clusters: entry.clusters.map(c => [...c]), singles: [...entry.singles] };

        const pruned = this.without(entry, present);
        this.entry = { optionsKey, faceIds: [...present], ...pruned };
        this.store.save(this.entry);
        return { clusters: pruned.clusters.map(c => [...c]), singles: [...pruned.singles] };
    }

    remember(faceIds: readonly number[], optionsKey: string, groups: ClusterGroups): void {
        this.entry = { optionsKey, faceIds: [...faceIds], clusters: groups.clusters.map(c => [...c]), singles: [...groups.singles] };
        this.store.save(this.entry);
    }

    private current(): CachedClustering | null {
        if (this.entry === undefined) this.entry = this.store.load();
        return this.entry;
    }

    private without(entry: CachedClustering, present: ReadonlySet<number>): ClusterGroups {
        const singles = entry.singles.filter(id => present.has(id));
        const clusters: number[][] = [];
        for (const cluster of entry.clusters) {
            const members = cluster.filter(id => present.has(id));
            if (members.length >= this.minClusterSize) clusters.push(members);
            else singles.push(...members);
        }
        return { clusters, singles };
    }
}
