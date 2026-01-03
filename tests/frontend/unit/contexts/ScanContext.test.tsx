/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanProvider, useScan } from '../../../../src/context/ScanContext';
import { AIProvider } from '../../../../src/context/AIContext';
import { AlertProvider } from '../../../../src/context/AlertContext';
import { ToastProvider } from '../../../../src/context/ToastContext';
import { mockIpcRenderer } from '../../../frontend/setup';

// Helper component to test context
function TestComponent() {
    const { photos, loadMorePhotos, filter, setFilter, loadingPhotos } = useScan();

    // Trigger initial filter load if not already
    useEffect(() => {
        if (filter.initial) {
            setFilter({}); // Clear initial state to trigger load
        }
    }, [filter, setFilter]);

    if (loadingPhotos && photos.length === 0) return <div data-testid="loading">Loading...</div>;
    return (
        <div>
            <div data-testid="count">{photos.length}</div>
            <button onClick={() => loadMorePhotos()} data-testid="load-more">Load More</button>
            <ul>
                {photos.map(p => <li key={p.id}>{p.file_path}</li>)}
            </ul>
        </div>
    );
}

describe('ScanContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock default settings/config responses
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'settings:getQueueConfig') return Promise.resolve({ batchSize: 0, cooldownSeconds: 60 });
            if (channel === 'settings:getAIQueue') return Promise.resolve([]);
            if (channel === 'ai:getSettings') return Promise.resolve({});
            if (channel === 'db:getPhotos') return Promise.resolve({ photos: [], total: 0 });
            if (channel === 'db:getAllTags') return Promise.resolve([]);
            if (channel === 'db:getFolders') return Promise.resolve([]);
            if (channel === 'db:getPeople') return Promise.resolve([]);
            if (channel === 'db:getScanErrors') return Promise.resolve([]);
            return Promise.resolve(null);
        });
    });

    it('should load photos when filter is set to All', async () => {
        // Arrange
        const mockPhotos = [
            { id: 1, file_path: 'photo1.jpg' },
            { id: 2, file_path: 'photo2.jpg' }
        ];
        mockIpcRenderer.invoke.mockImplementation((channel, args) => {
            if (channel === 'db:getPhotos') return Promise.resolve({ photos: mockPhotos, total: 2 });
            return Promise.resolve(null);
        });

        // Act
        render(
            <ToastProvider>
                <AlertProvider>
                    <AIProvider>
                        <ScanProvider>
                            <TestComponent />
                        </ScanProvider>
                    </AIProvider>
                </AlertProvider>
            </ToastProvider>
        );

        // Assert
        await waitFor(() => {
            expect(screen.getByTestId('count')).toHaveTextContent('2');
        });

        expect(screen.getByText('photo1.jpg')).toBeInTheDocument();
        expect(screen.getByText('photo2.jpg')).toBeInTheDocument();
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('db:getPhotos', expect.objectContaining({
            filter: {}
        }));
    });

    it('should handle loadMorePhotos correctly', async () => {
        // Arrange
        let callCount = 0;
        mockIpcRenderer.invoke.mockImplementation((channel, args) => {
            if (channel === 'db:getPhotos') {
                callCount++;
                if (args.offset === 0) {
                    // Return 50 items to ensure hasMore is true
                    const photos = Array.from({ length: 50 }, (_, i) => ({ id: i, file_path: `p${i}.jpg` }));
                    return Promise.resolve({ photos, total: 100 });
                }
                if (args.offset === 50) return Promise.resolve({ photos: [{ id: 100, file_path: 'p100.jpg' }], total: 100 });
            }
            return Promise.resolve(null);
        });

        // Act
        render(
            <ToastProvider>
                <AlertProvider>
                    <AIProvider>
                        <ScanProvider>
                            <TestComponent />
                        </ScanProvider>
                    </AIProvider>
                </AlertProvider>
            </ToastProvider>
        );

        await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('50'));

        // Load more
        screen.getByTestId('load-more').click();

        // Assert
        await waitFor(() => {
            expect(screen.getByTestId('count')).toHaveTextContent('51');
        });
        expect(screen.getByText('p100.jpg')).toBeInTheDocument();
    });
});
