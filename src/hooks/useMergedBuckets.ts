import { useMemo } from 'react';
import { FaceBucket, MergedBucket } from '../types';

interface UseMergedBucketsOptions {
    enabled?: boolean;
    maxMergedSize?: number;
}

export function useMergedBuckets(buckets: FaceBucket[], options: UseMergedBucketsOptions = {}) {
    // Defatul options
    const { enabled = true, maxMergedSize = 50 } = options;

    const isMerging = false; // Placeholder if we need it later, or just remove it. Keeping const to match return signature.

    // We use a debounced effect or just simple useMemo. 
    // Since merging is synchronous and relatively fast for < 5000 buckets, useMemo is fine.
    // However, to show a spinner if it takes time, we might want to wrap it. 
    // But useMemo finishes before render.
    // Given JS single thread, a spinner only shows if we defer execution.
    // For 5000 items, array ops are sub-10ms. Let's stick to useMemo for simplicity unless user reports lag.
    // We'll keep isMerging state in case we want to move to async/worker later.

    const mergedBuckets = useMemo(() => {
        if (!enabled || buckets.length === 0) {
            return buckets as MergedBucket[];
        }

        const grouped = new Map<number, FaceBucket[]>();

        // 1. Group by suggested_person_id
        for (const bucket of buckets) {
            // Only group Suggestion buckets (those with a person ID)
            if (bucket.bucket_type === 'suggestion' && bucket.suggested_person_id) {
                const key = bucket.suggested_person_id;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(bucket);
            } else {
                // Discoveries or unassigned suggestions (rare) go to a separate "key" or pass through?
                // Let's pass them through as-is, or handle them via negative keys?
                // For now, only merge Suggestions by person.
                // Leave others to be appended at the end.
                // Actually, logic is usually specific to Suggestions tab.
                // So we'll assume the input `buckets` are all Suggestions if this hook is used there.
                // But just in case, we'll segregate.
                const key = -1 * (bucket.id || Math.random()); // Unique non-colliding key
                grouped.set(key, [bucket]);
            }
        }

        const result: MergedBucket[] = [];

        // 2. Merge logic
        for (const [key, group] of grouped) {
            // If negative key or no personId, these are unmergeable items (or singletons)
            if (key < 0) {
                result.push({
                    ...group[0],
                    is_merged: false,
                    source_buckets: [group[0]]
                });
                continue;
            }

            // It's a valid person group. Merge until max size.
            // Sort by size desc first to pack efficiently? Or just iterate?
            // "Best experience" usually means bigger groups first. 
            // Current `buckets` are already sorted by size desc from backend.
            // Let's keep that order.

            let currentMerge: MergedBucket | null = null;

            for (const b of group) {
                if (!currentMerge) {
                    // Start new merge group
                    currentMerge = {
                        ...b, // Inherit metadata from first bucket (person name, etc)
                        face_ids: [...b.face_ids],
                        source_buckets: [b],
                        is_merged: false // Will set to true if we actually add more
                    };
                } else {
                    // Try to add
                    if (currentMerge.face_ids.length + b.face_ids.length <= maxMergedSize) {
                        currentMerge.face_ids.push(...b.face_ids);
                        currentMerge.source_buckets.push(b);
                        currentMerge.face_count = currentMerge.face_ids.length;
                        currentMerge.is_merged = true;
                    } else {
                        // Full. Push current and start new.
                        result.push(currentMerge);
                        currentMerge = {
                            ...b,
                            face_ids: [...b.face_ids],
                            source_buckets: [b],
                            is_merged: false
                        };
                    }
                }
            }
            if (currentMerge) {
                result.push(currentMerge);
            }
        }

        // 3. Sort final result by count desc
        return result.sort((a, b) => b.face_count - a.face_count);
    }, [buckets, enabled, maxMergedSize]);

    return { mergedBuckets, isMerging };
}
