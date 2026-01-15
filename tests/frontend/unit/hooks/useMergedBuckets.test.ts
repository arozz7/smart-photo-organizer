/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useMergedBuckets } from '../../../../src/hooks/useMergedBuckets';
import { FaceBucket } from '../../../../src/types';

const mockBucket = (id: number, type: 'suggestion' | 'discovery', personId: number | null, faces: number[]): FaceBucket => ({
    id,
    bucket_type: type,
    suggested_person_id: personId,
    face_ids: faces,
    face_count: faces.length,
    status: 'active'
});

describe('useMergedBuckets', () => {

    it('should return empty array given empty input', () => {
        const { result } = renderHook(() => useMergedBuckets([], { enabled: true }));
        expect(result.current.mergedBuckets).toEqual([]);
    });

    it('should explicitly group suggestions by person_id', () => {
        const buckets = [
            mockBucket(1, 'suggestion', 101, [1, 2]),
            mockBucket(2, 'suggestion', 101, [3, 4]),
            mockBucket(3, 'suggestion', 102, [5, 6])
        ];

        const { result } = renderHook(() => useMergedBuckets(buckets, { enabled: true }));

        // Should have 2 groups: Person 101 (merged) and Person 102 (single)
        const groups = result.current.mergedBuckets;
        expect(groups).toHaveLength(2);

        // Person 101 group
        const group101 = groups.find(b => b.suggested_person_id === 101);
        expect(group101).toBeDefined();
        expect(group101?.face_ids).toHaveLength(4);
        expect(group101?.face_ids).toEqual(expect.arrayContaining([1, 2, 3, 4]));
        expect((group101 as any).is_merged).toBe(true);
        expect((group101 as any).source_buckets).toHaveLength(2);

        // Person 102 group
        const group102 = groups.find(b => b.suggested_person_id === 102);
        expect(group102).toBeDefined();
        expect(group102?.face_ids).toHaveLength(2);
    });

    it('should respect maxMergedSize', () => {
        const buckets = [
            mockBucket(1, 'suggestion', 101, [1, 2, 3, 4]), // 4 faces
            mockBucket(2, 'suggestion', 101, [5, 6, 7, 8]), // 4 faces
        ];

        // Max size 5. Group 1 has 4. Adding Group 2 (4) = 8 > 5. Should split.
        const { result } = renderHook(() => useMergedBuckets(buckets, { enabled: true, maxMergedSize: 5 }));

        const groups = result.current.mergedBuckets;
        expect(groups).toHaveLength(2);
        expect(groups[0].face_ids).toHaveLength(4);
        expect(groups[1].face_ids).toHaveLength(4);
        expect((groups[0] as any).is_merged).toBe(false); // First one wasn't merged with anything effectively
    });

    it('should merge up to limit', () => {
        const buckets = [
            mockBucket(1, 'suggestion', 101, [1, 2]), // 2
            mockBucket(2, 'suggestion', 101, [3, 4]), // +2 = 4
            mockBucket(3, 'suggestion', 101, [5, 6]), // +2 = 6 > 5. Should split.
        ];

        const { result } = renderHook(() => useMergedBuckets(buckets, { enabled: true, maxMergedSize: 5 }));
        const groups = result.current.mergedBuckets;

        // Expect Group 1 (Ids 1,2,3,4) and Group 2 (Ids 5,6)
        expect(groups).toHaveLength(2);

        // Sort by face count desc default, so 4 faces first
        expect(groups[0].face_ids).toHaveLength(4);
        expect(groups[0].source_buckets).toHaveLength(2);

        expect(groups[1].face_ids).toHaveLength(2);
    });

    it('should disable merging when enabled=false', () => {
        const buckets = [
            mockBucket(1, 'suggestion', 101, [1, 2]),
            mockBucket(2, 'suggestion', 101, [3, 4])
        ];

        const { result } = renderHook(() => useMergedBuckets(buckets, { enabled: false }));
        expect(result.current.mergedBuckets).toHaveLength(2);
        expect(result.current.mergedBuckets[0].id).toBe(1);
    });

    it('should pass through discovery buckets without merging', () => {
        const buckets = [
            mockBucket(1, 'discovery', null, [1, 2]),
            mockBucket(2, 'discovery', null, [3, 4])
        ];

        const { result } = renderHook(() => useMergedBuckets(buckets, { enabled: true }));
        expect(result.current.mergedBuckets).toHaveLength(2);
        expect((result.current.mergedBuckets[0] as any).is_merged).toBe(false);
    });
});
