// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { useDiscoveryMerge } from '../../../../src/hooks/useDiscoveryMerge';
import { FaceBucket } from '../../../../src/types';

describe('useDiscoveryMerge', () => {
    const mockBuckets: FaceBucket[] = [
        {
            id: 1,
            bucket_type: 'discovery',
            face_ids: [1, 2],
            face_count: 2,
            suggested_person_id: 10, // Suggested name: Person A
            status: 'active',
            created_at: '',
            updated_at: ''
        },
        {
            id: 2,
            bucket_type: 'discovery',
            face_ids: [3, 4],
            face_count: 2,
            suggested_person_id: 10, // Suggested name: Person A (Same)
            status: 'active',
            created_at: '',
            updated_at: ''
        },
        {
            id: 3,
            bucket_type: 'discovery',
            face_ids: [5],
            face_count: 1,
            suggested_person_id: 20, // Suggested name: Person B
            status: 'active',
            created_at: '',
            updated_at: ''
        },
        {
            id: 4,
            bucket_type: 'discovery',
            face_ids: [6],
            face_count: 1,
            suggested_person_id: null, // No suggestion
            status: 'active',
            created_at: '',
            updated_at: ''
        }
    ];

    it('should pass through buckets if disabled', () => {
        const { result } = renderHook(() => useDiscoveryMerge(mockBuckets, { enabled: false }));
        expect(result.current.mergedBuckets).toHaveLength(4);
        expect(result.current.mergedBuckets[0].face_ids).toEqual([1, 2]);
    });

    it('should merge buckets with same suggested_person_id', () => {
        const { result } = renderHook(() => useDiscoveryMerge(mockBuckets, { enabled: true }));

        // 4 buckets -> 3 merged groups:
        // 1+2 (Person A)
        // 3 (Person B)
        // 4 (No suggestion)
        expect(result.current.mergedBuckets).toHaveLength(3);

        const personAGroup = result.current.mergedBuckets.find(b => b.suggested_person_id === 10);
        expect(personAGroup).toBeDefined();
        expect(personAGroup?.face_ids.length).toBe(4); // 2 + 2
        expect(personAGroup?.source_buckets).toHaveLength(2);

        const noSuggestionGroup = result.current.mergedBuckets.find(b => b.id === 4);
        expect(noSuggestionGroup).toBeDefined();
    });

    it('should respect maxMergedSize', () => {
        const { result } = renderHook(() => useDiscoveryMerge(mockBuckets, { enabled: true, maxMergedSize: 3 }));

        // Group A has 4 faces total. Max size 3.
        // Should split into [Bucket 1 (2 faces)] + [Bucket 2 (2 faces)] -> Wait.
        // Merge logic: Bucket 1 (2) + Bucket 2 (2) = 4 > 3? 
        // Logic in useMergedBuckets:
        // if (current + next <= max) merge; else push current, start new.
        // 2 + 2 = 4 > 3. So they will NOT merge.

        // So we expect 4 groups? Or 3?
        // Bucket 1 (2) -> Standard
        // Bucket 2 (2) -> Standard (Can't merge with 1)
        // Bucket 3 (1) -> Standard
        // Bucket 4 (1) -> Standard
        expect(result.current.mergedBuckets).toHaveLength(4);
    });
});
