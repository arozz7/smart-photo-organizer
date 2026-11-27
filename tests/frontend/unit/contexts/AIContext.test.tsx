/**
 * @vitest-environment happy-dom
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider, useAI } from '../../../../src/context/AIContext';
import { AlertProvider } from '../../../../src/context/AlertContext';
import { ToastProvider } from '../../../../src/context/ToastContext';
import { mockIpcRenderer } from '../../../frontend/setup';

// Helper component to test context
function TestComponent() {
    const {
        processingQueue,
        addToQueue,
        isPaused,
        setIsPaused,
        isProcessing,
        calculatingBlur,
        calculateBlurScores
    } = useAI();

    return (
        <div>
            <div data-testid="queue-length">{processingQueue.length}</div>
            <div data-testid="is-paused">{isPaused ? 'paused' : 'running'}</div>
            <div data-testid="is-processing">{isProcessing ? 'processing' : 'idle'}</div>
            <div data-testid="is-calculating-blur">{calculatingBlur ? 'calculating' : 'idle'}</div>

            <button data-testid="btn-add" onClick={() => addToQueue([{ id: 1, file_path: 'test.jpg' }], true)}>
                Add & Start
            </button>
            <button data-testid="btn-pause" onClick={() => setIsPaused(true)}>Pause</button>
            <button data-testid="btn-resume" onClick={() => setIsPaused(false)}>Resume</button>
            <button data-testid="btn-blur" onClick={() => calculateBlurScores()}>Calc Blur</button>
        </div>
    );
}

describe('AIContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default mocks
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'settings:getQueueConfig') return Promise.resolve({ batchSize: 0, cooldownSeconds: 60 });
            if (channel === 'settings:getAIQueue') return Promise.resolve([]);
            if (channel === 'ai:getSettings') return Promise.resolve({});
            if (channel === 'ai:command') return Promise.resolve({ type: 'system_status_result', status: {} });
            if (channel === 'db:getPhotos') return Promise.resolve({ photos: [], total: 0 });
            if (channel === 'db:getAllTags') return Promise.resolve([]);
            if (channel === 'db:getFolders') return Promise.resolve([]);
            if (channel === 'db:getPeople') return Promise.resolve([]);
            if (channel === 'db:getScanErrors') return Promise.resolve([]);
            if (channel === 'ai:saveVectorIndex') return Promise.resolve({ success: true });
            return Promise.resolve({ success: true });
        });
    });

    it('should add items to queue and auto-start if requested', async () => {
        // Act
        render(
            <ToastProvider>
                <AlertProvider>
                    <AIProvider>
                        <TestComponent />
                    </AIProvider>
                </AlertProvider>
            </ToastProvider>
        );

        // Assert initial state (Queue starts paused by default in AIContext.tsx:122)
        expect(screen.getByTestId('is-paused')).toHaveTextContent('paused');

        // Click Add & Start
        screen.getByTestId('btn-add').click();

        // Assert state update
        await waitFor(() => {
            expect(screen.getByTestId('queue-length')).toHaveTextContent('1');
            expect(screen.getByTestId('is-paused')).toHaveTextContent('running');
        });

        // AIContext.tsx:681: if (queue empty or processing or paused or coolingDown) return;
        // Since we added an item and unpaused, it should try to process.
        await waitFor(() => {
            expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('ai:analyzeImage', expect.any(Object));
        });
    });

    it('should handle blur calculation flow', async () => {
        // Arrange
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'db:getPhotosMissingBlurScores') return Promise.resolve({ success: true, photoIds: [10, 20] });
            if (channel === 'ai:scanImage') return Promise.resolve({ success: true });
            if (channel === 'ai:saveVectorIndex') return Promise.resolve({ success: true });
            return Promise.resolve({ success: true });
        });

        // Act
        render(
            <ToastProvider>
                <AlertProvider>
                    <AIProvider>
                        <TestComponent />
                    </AIProvider>
                </AlertProvider>
            </ToastProvider>
        );

        // Click Calc Blur
        screen.getByTestId('btn-blur').click();

        // Assert completion toast appears (which implies it went through calculating state)
        await waitFor(() => {
            expect(screen.getByText(/Finished calculating blur scores/)).toBeInTheDocument();
        });
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('db:getPhotosMissingBlurScores');
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('ai:scanImage', expect.objectContaining({ photoId: 10 }));
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('ai:scanImage', expect.objectContaining({ photoId: 20 }));
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('ai:saveVectorIndex');

        await waitFor(() => {
            expect(screen.getByTestId('is-calculating-blur')).toHaveTextContent('idle');
        });
    });

    it('should react to ai:scan-result events', async () => {
        // Arrange
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'settings:getAIQueue') return Promise.resolve([{ id: 1, file_path: 'test.jpg' }]);
            return Promise.resolve({ success: true });
        });

        // Act
        render(
            <ToastProvider>
                <AlertProvider>
                    <AIProvider>
                        <TestComponent />
                    </AIProvider>
                </AlertProvider>
            </ToastProvider>
        );

        // Wait for queue to load from persistence
        await waitFor(() => {
            expect(screen.getByTestId('queue-length')).toHaveTextContent('1');
        });

        // Simulate scan result from main process
        mockIpcRenderer.emit('ai:scan-result', {
            photoId: 1,
            type: 'analysis_result',
            faces: [],
            tags: []
        });

        // Assert item removed from queue
        await waitFor(() => {
            expect(screen.getByTestId('queue-length')).toHaveTextContent('0');
        });
    });

    it('ends the pause between batches by the clock, not by counting timer ticks (a hidden window runs a 1-second timer about once a minute, which made a 60 s pause last 54 minutes)', async () => {
        vi.useFakeTimers();
        try {
            mockIpcRenderer.invoke.mockImplementation((channel) => {
                if (channel === 'settings:getQueueConfig') return Promise.resolve({ batchSize: 1, cooldownSeconds: 60 });
                if (channel === 'settings:getAIQueue') return Promise.resolve([{ id: 1, file_path: 'a.jpg' }, { id: 2, file_path: 'b.jpg' }]);
                return Promise.resolve({ success: true });
            });
            render(
                <ToastProvider>
                    <AlertProvider>
                        <AIProvider>
                            <TestComponent />
                        </AIProvider>
                    </AlertProvider>
                </ToastProvider>
            );
            const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
            const analysed = () => mockIpcRenderer.invoke.mock.calls
                .filter(([channel]) => channel === 'ai:analyzeImage')
                .map(([, payload]) => payload.photoId);
            await tick(0);
            await act(async () => { screen.getByTestId('btn-resume').click(); });
            await tick(0);
            expect(analysed()).toEqual([1]);

            // the first photo is done: the batch limit (1) starts the pause
            await act(async () => { mockIpcRenderer.emit('ai:scan-result', { photoId: 1, type: 'analysis_result', faces: [], tags: [] }); });
            await tick(0);
            expect(analysed()).toEqual([1]);

            // the window was hidden: a whole minute passed, but the timer ran only once
            vi.setSystemTime(Date.now() + 61_000);
            await tick(1000);
            await tick(0);

            expect(analysed()).toEqual([1, 2]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not re-render its consumers when a status poll returns the same values (it did every second while grouping, which made Home flicker)', async () => {
        vi.useFakeTimers();
        try {
            let renders = 0;
            const Counter = () => {
                const { bucketingStatus, systemStatus } = useAI();
                renders++;
                return <div data-testid="grouping">{bucketingStatus.offset}/{String(systemStatus?.system?.python)}</div>;
            };
            // every poll answers with a NEW object holding the same values
            mockIpcRenderer.invoke.mockImplementation((channel) => {
                if (channel === 'db:getBucketingStatus') return Promise.resolve({ active: true, offset: 5, total: 10, remaining: 5 });
                if (channel === 'db:getIgnoredRecheckStatus') return Promise.resolve({ active: false, offset: 0, total: 0 });
                if (channel === 'ai:command') return Promise.resolve({ type: 'system_status_result', status: { system: { python: '3.11' } } });
                if (channel === 'settings:getQueueConfig') return Promise.resolve({ batchSize: 0, cooldownSeconds: 60 });
                if (channel === 'settings:getAIQueue') return Promise.resolve([]);
                return Promise.resolve({ success: true });
            });
            render(
                <ToastProvider>
                    <AlertProvider>
                        <AIProvider>
                            <Counter />
                        </AIProvider>
                    </AlertProvider>
                </ToastProvider>
            );
            const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
            await tick(0);
            await tick(1000);
            await tick(1000);
            expect(screen.getByTestId('grouping')).toHaveTextContent('5/3.11');
            const settled = renders;

            for (let i = 0; i < 5; i++) await tick(1000);

            expect(mockIpcRenderer.invoke.mock.calls.filter(([channel]) => channel === 'db:getBucketingStatus').length).toBeGreaterThan(5);
            expect(renders).toBe(settled);

            // the counter is polled every second, but the (single-threaded) Python engine is asked for its status far less often
            const asked = (type: string) => mockIpcRenderer.invoke.mock.calls.filter(([channel, payload]) => channel === 'ai:command' && payload?.type === type).length;
            const groupingPolls = mockIpcRenderer.invoke.mock.calls.filter(([channel]) => channel === 'db:getBucketingStatus').length;
            expect(asked('get_system_status')).toBeLessThan(groupingPolls / 2);
        } finally {
            vi.useRealTimers();
        }
    });
});
