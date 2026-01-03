/**
 * @vitest-environment happy-dom
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePeopleCluster } from '../../../../src/hooks/usePeopleCluster';
import { TestProviders } from '../../mocks/mockProviders';
import { mockIpcRenderer } from '../../setup';

describe('usePeopleCluster', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default mocks for required contexts
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'db:getPeople') return Promise.resolve([]);
            if (channel === 'ai:getClusteredFaces') return Promise.resolve({ clusters: [], singles: [] });
            if (channel === 'settings:getQueueConfig') return Promise.resolve({});
            if (channel === 'settings:getAIQueue') return Promise.resolve([]);
            if (channel === 'ai:getSettings') return Promise.resolve({});
            return Promise.resolve({ success: true });
        });
    });

    it('should load clustered faces correctly', async () => {
        // Arrange
        const mockResult = {
            clusters: [[1, 2], [3, 4, 5]],
            singles: [6]
        };
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'ai:getClusteredFaces') return Promise.resolve(mockResult);
            return Promise.resolve({ success: true });
        });

        // Act
        const { result } = renderHook(() => usePeopleCluster(), {
            wrapper: TestProviders
        });

        await act(async () => {
            await result.current.loadClusteredFaces();
        });

        // Assert
        expect(result.current.clusters).toHaveLength(2);
        // Sorted by size in usePeopleCluster.ts:49
        expect(result.current.clusters[0].faces).toEqual([3, 4, 5]);
        expect(result.current.clusters[1].faces).toEqual([1, 2]);
        expect(result.current.singles).toEqual([6]);
        expect(result.current.totalFaces).toBe(6);
    });

    it('should toggle face selection correctly', async () => {
        // Act
        const { result } = renderHook(() => usePeopleCluster(), {
            wrapper: TestProviders
        });

        act(() => {
            result.current.toggleFace(1);
        });
        expect(result.current.selectedFaceIds.has(1)).toBe(true);

        act(() => {
            result.current.toggleFace(1);
        });
        expect(result.current.selectedFaceIds.has(1)).toBe(false);
    });

    it('should handle ungrouping correctly', async () => {
        // Arrange
        const mockResult = {
            clusters: [[1, 2]],
            singles: [3]
        };
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'ai:getClusteredFaces') return Promise.resolve(mockResult);
            return Promise.resolve({ success: true });
        });

        const { result } = renderHook(() => usePeopleCluster(), {
            wrapper: TestProviders
        });

        await act(async () => {
            await result.current.loadClusteredFaces();
        });

        // Act: Ungroup cluster 0 [1, 2]
        act(() => {
            result.current.handleUngroup(0);
        });

        // Assert
        expect(result.current.clusters).toHaveLength(0);
        expect(result.current.singles).toContain(1);
        expect(result.current.singles).toContain(2);
        expect(result.current.singles).toContain(3);
        expect(result.current.singles).toHaveLength(3);
    });

    it('should ignore all groups correctly', async () => {
        // Arrange
        const mockResult = {
            clusters: [[1, 2], [3, 4]],
            singles: [5]
        };
        mockIpcRenderer.invoke.mockImplementation((channel) => {
            if (channel === 'ai:getClusteredFaces') return Promise.resolve(mockResult);
            if (channel === 'db:ignoreFaces') return Promise.resolve({ success: true });
            return Promise.resolve({ success: true });
        });

        const { result } = renderHook(() => usePeopleCluster(), {
            wrapper: TestProviders
        });

        await act(async () => {
            await result.current.loadClusteredFaces();
        });

        // Act
        act(() => {
            result.current.handleIgnoreAllGroups();
        });

        // Trigger onConfirm of showConfirm
        // Since useAlert is mocked in TestProviders (which uses real AlertProvider), 
        // we might need to find the confirm button if we were rendering a component.
        // But here we want to test the hook's interaction with the alert.

        // Wait, showConfirm is called. In a real hook test, if we use the real AlertProvider, 
        // it updates the alert state.

        // Simpler: Mock useAlert for this specific test to call onConfirm immediately.
    });
});
