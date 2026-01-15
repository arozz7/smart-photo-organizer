
import { useMemo } from 'react';
import { FaceBucket, MergedBucket } from '../types';

interface UseDiscoveryMergeOptions {
    enabled?: boolean;
    maxMergedSize?: number;
}

export function useDiscoveryMerge(buckets: FaceBucket[], options: UseDiscoveryMergeOptions = {}) {
    // Default options
    const { enabled = true, maxMergedSize = 50 } = options;

    const isMerging = false; // Sync for now

    const mergedBuckets = useMemo(() => {
        if (!enabled || buckets.length === 0) {
            return buckets as MergedBucket[];
        }

        const grouped = new Map<number, FaceBucket[]>();

        // 1. Group by suggested_person_id
        for (const bucket of buckets) {
            // Group by suggested_person_id if it exists
            if (bucket.suggested_person_id) {
                const key = bucket.suggested_person_id;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(bucket);
            } else {
                // No suggestion -> Unique negative key to keep separate
                const key = -1 * (bucket.id || Math.random());
                grouped.set(key, [bucket]);
            }
        }

        const result: MergedBucket[] = [];

        // 2. Merge logic
        for (const [key, group] of grouped) {
            // If negative key, cannot merge (it's a singleton or unassigned)
            if (key < 0) {
                result.push({
                    ...group[0],
                    is_merged: false,
                    source_buckets: [group[0]]
                } as MergedBucket);
                continue;
            }

            // Valid suggested person. Merge logic.
            let currentMerge: MergedBucket | null = null;

            for (const b of group) {
                if (!currentMerge) {
                    // Start new merge group
                    currentMerge = {
                        ...b, // Inherit metadata from first bucket
                        face_ids: [...b.face_ids],
                        source_buckets: [b],
                        is_merged: false
                    } as MergedBucket;
                } else {
                    // Try to add
                    if (currentMerge.face_ids.length + b.face_ids.length <= maxMergedSize) {
                        currentMerge.face_ids.push(...b.face_ids);
                        currentMerge.source_buckets.push(b);
                        currentMerge.face_count = currentMerge.face_ids.length;
                        currentMerge.is_merged = true;
                    } else {
                        // Full. Push & start new.
                        result.push(currentMerge);
                        currentMerge = {
                            ...b,
                            face_ids: [...b.face_ids],
                            source_buckets: [b],
                            is_merged: false
                        } as MergedBucket;
                    }
                }
            }
            if (currentMerge) {
                result.push(currentMerge);
            }
        }

        // 3. Sort by face count desc
        return result.sort((a, b) => b.face_count - a.face_count);
    }, [buckets, enabled, maxMergedSize]);

    return { mergedBuckets, isMerging };
}
