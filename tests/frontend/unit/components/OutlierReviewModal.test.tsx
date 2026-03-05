// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import OutlierReviewModal from '../../../../src/components/OutlierReviewModal';
import * as ScanContextModule from '../../../../src/context/ScanContext';

// Mock dependencies
vi.mock('../../../../src/components/FaceThumbnail', () => ({
    default: ({ src }: { src: string }) => <img data-testid="face-thumbnail" src={src} />
}));

// Mock usePeople to avoid PeopleProvider requirement
vi.mock('../../../../src/context/PeopleContext', () => ({
    usePeople: () => ({
        people: [],
        loading: false,
        loadPeople: vi.fn(),
        fetchFacesByIds: vi.fn().mockResolvedValue([])
    })
}));

// Mock useDynamicGrid to avoid ToastProvider/useToast dependency in unit tests
vi.mock('../../../../src/hooks/useDynamicGrid', () => ({
    useDynamicGrid: () => ({
        containerRef: () => {},
        gridStyle: { gridTemplateColumns: 'repeat(8, 1fr)' }
    })
}));

// Mock react-virtuoso so VirtuosoGrid renders items directly (no layout measurement needed)
vi.mock('react-virtuoso', () => ({
    VirtuosoGrid: ({ totalCount, itemContent }: { totalCount: number; itemContent: (index: number) => React.ReactNode }) => (
        <div data-testid="virtuoso-grid">
            {Array.from({ length: totalCount }, (_, i) => (
                <div key={i}>{itemContent(i)}</div>
            ))}
        </div>
    )
}));

describe('OutlierReviewModal', () => {

    const mockOutliers = [
        {
            faceId: 101,
            photoId: 501,
            box: { x: 0, y: 0, width: 100, height: 100 },
            descriptor: [],
            personId: 1,
            file_path: '/photos/test.jpg',
            preview_cache_path: '/cache/test.jpg',
            photo_width: 800,
            photo_height: 600,
            is_ignored: false,
            distance: 0.9,
            blurScore: 100,
            photo_id: 501 // Ensure this matches usage
        }
    ];

    it('renders preview button and calls viewPhoto on click', () => {
        const mockViewPhoto = vi.fn();

        // Spy on useScan
        vi.spyOn(ScanContextModule, 'useScan').mockReturnValue({
            viewPhoto: mockViewPhoto,
            viewingPhoto: null,
            setViewingPhoto: vi.fn(),
            navigateToPhoto: vi.fn(),
            // @ts-ignore
            isScanning: false
        });

        render(
            <OutlierReviewModal
                isOpen={true}
                onClose={() => { }}
                personName="Test Person"
                // @ts-ignore
                outliers={mockOutliers}
                onRemoveFaces={async () => { }}
                onMoveFaces={async () => { }}
                onRefresh={() => { }}
            />
        );

        // Check if thumbnail rendered
        expect(screen.getByTestId('face-thumbnail')).toBeInTheDocument();

        // Check for View Original Photo button (title attribute)
        const viewButton = screen.getByTitle('View Original Photo');
        expect(viewButton).toBeInTheDocument();

        // Click it
        fireEvent.click(viewButton);

        // Verify viewPhoto was called with photoId
        expect(mockViewPhoto).toHaveBeenCalledWith(501);
    });
});
