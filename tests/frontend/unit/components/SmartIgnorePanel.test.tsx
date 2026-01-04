/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../setup'; // Frontend setup which includes mocks
import SmartIgnorePanel from '../../../../src/components/SmartIgnorePanel';
import * as PeopleContext from '../../../../src/context/PeopleContext';

// ResizeObserver mock
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('SmartIgnorePanel', () => {
    const mockSettings = {
        minPhotoAppearances: 3,
        maxClusterSize: 2,
        centroidDistanceThreshold: 0.7,
        outlierThreshold: 1.2,
        autoAssignThreshold: 0.7,
        reviewThreshold: 0.9,
        enableAutoTiering: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(PeopleContext, 'usePeople').mockReturnValue({
            smartIgnoreSettings: mockSettings
        } as any);
    });

    it('renders correctly with title and stats', () => {
        render(
            <SmartIgnorePanel
                onFilterBackground={() => { }}
                onIgnoreAllGroups={() => { }}
                stats={{ autoIgnored: 5, backgroundIdentified: 10, pendingReview: 3 }}
            />
        );

        // Title
        expect(screen.getByText('Smart Ignore')).toBeInTheDocument();

        // Stats - checking the structure with text partial matching
        expect(screen.getByText('5')).toBeInTheDocument(); // autoIgnored count
        expect(screen.getByText('3')).toBeInTheDocument(); // pendingReview count
        expect(screen.getByText(/assigned/)).toBeInTheDocument();
        expect(screen.getByText(/to review/)).toBeInTheDocument();
    });

    it('renders action buttons', () => {
        render(
            <SmartIgnorePanel
                onFilterBackground={() => { }}
                onIgnoreAllGroups={() => { }}
            />
        );

        // Compact button labels
        expect(screen.getByText('Filter BG')).toBeInTheDocument();
        expect(screen.getByText('Ignore All')).toBeInTheDocument();
    });

    it('triggers action callbacks', () => {
        const onFilterMock = vi.fn();
        const onIgnoreMock = vi.fn();

        render(
            <SmartIgnorePanel
                onFilterBackground={onFilterMock}
                onIgnoreAllGroups={onIgnoreMock}
            />
        );

        fireEvent.click(screen.getByText('Filter BG'));
        expect(onFilterMock).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Ignore All'));
        expect(onIgnoreMock).toHaveBeenCalled();
    });

    it('returns null when smartIgnoreSettings is not available', () => {
        vi.spyOn(PeopleContext, 'usePeople').mockReturnValue({
            smartIgnoreSettings: null
        } as any);

        const { container } = render(
            <SmartIgnorePanel
                onFilterBackground={() => { }}
                onIgnoreAllGroups={() => { }}
            />
        );

        expect(container.firstChild).toBeNull();
    });
});
