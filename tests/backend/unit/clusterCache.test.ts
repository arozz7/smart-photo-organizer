import { describe, it, expect, vi } from 'vitest';
import { ClusterCache, clusterOptionsKey, type CachedClustering, type ClusterCacheStore } from '../../../electron/core/services/clusterCache';

const KEY = clusterOptionsKey({ eps: 0.45, minSamples: 2, maxSize: 200, minCohesion: 0.6, maxSpread: 0.75 });

function memoryStore(initial: CachedClustering | null = null): ClusterCacheStore & { saved: CachedClustering[] } {
    let stored = initial;
    const saved: CachedClustering[] = [];
    return { saved, load: () => stored, save: entry => { stored = entry; saved.push(entry); } };
}

const result = { clusters: [[1, 2, 3], [4, 5]], singles: [6, 7] };

describe('ClusterCache', () => {
    it('has nothing before a clustering was remembered', () => {
        expect(new ClusterCache(memoryStore()).lookup([1, 2, 3], KEY)).toBeNull();
    });

    it('gives back the remembered clusters for the same faces and options', () => {
        const cache = new ClusterCache(memoryStore());
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        expect(cache.lookup([7, 6, 5, 4, 3, 2, 1], KEY)).toEqual(result);
    });

    it('survives a restart: a new cache over the same store finds it', () => {
        const store = memoryStore();
        new ClusterCache(store).remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        expect(new ClusterCache(store).lookup([1, 2, 3, 4, 5, 6, 7], KEY)).toEqual(result);
    });

    it('takes faces that left the list out of the clusters instead of clustering again', () => {
        const cache = new ClusterCache(memoryStore());
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        const hit = cache.lookup([1, 2, 3, 4, 5, 7], KEY); // 6 was assigned elsewhere

        expect(hit).toEqual({ clusters: [[1, 2, 3], [4, 5]], singles: [7] });
    });

    it('turns a cluster that lost too many faces into singles', () => {
        const cache = new ClusterCache(memoryStore());
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        const hit = cache.lookup([1, 2, 3, 4, 6, 7], KEY); // 5 left: [4] is no cluster any more

        expect(hit).toEqual({ clusters: [[1, 2, 3]], singles: [6, 7, 4] });
    });

    it('does not use the cache when there are faces it never saw (they need clustering)', () => {
        const cache = new ClusterCache(memoryStore());
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        expect(cache.lookup([1, 2, 3, 4, 5, 6, 7, 8], KEY)).toBeNull();
    });

    it('does not use the cache for other settings or another version of the grouping', () => {
        const cache = new ClusterCache(memoryStore());
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        expect(cache.lookup([1, 2, 3, 4, 5, 6, 7], clusterOptionsKey({ eps: 0.5, minSamples: 2, maxSize: 200, minCohesion: 0.6, maxSpread: 0.75 }))).toBeNull();
        expect(cache.lookup([1, 2, 3, 4, 5, 6, 7], KEY.replace(/^v\d+/, 'v0'))).toBeNull();
    });

    it('keeps what a hit pruned, so the saved copy follows the library', () => {
        const store = memoryStore();
        const cache = new ClusterCache(store);
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        cache.lookup([1, 2, 3, 4, 5, 7], KEY);

        expect(store.saved.at(-1)?.faceIds.sort()).toEqual([1, 2, 3, 4, 5, 7]);
    });

    it('does not write the store when a hit pruned nothing', () => {
        const store = memoryStore();
        const save = vi.spyOn(store, 'save');
        const cache = new ClusterCache(store);
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);
        save.mockClear();

        cache.lookup([1, 2, 3, 4, 5, 6, 7], KEY);

        expect(save).not.toHaveBeenCalled();
    });

    it('gives a copy, so the caller cannot change what is remembered', () => {
        const cache = new ClusterCache(memoryStore());
        cache.remember([1, 2, 3, 4, 5, 6, 7], KEY, result);

        cache.lookup([1, 2, 3, 4, 5, 6, 7], KEY)!.clusters[0].push(99);

        expect(cache.lookup([1, 2, 3, 4, 5, 6, 7], KEY)!.clusters[0]).toEqual([1, 2, 3]);
    });
});
