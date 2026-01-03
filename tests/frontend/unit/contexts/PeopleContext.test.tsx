/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeopleProvider, usePeople } from '../../../../src/context/PeopleContext';
import { AIProvider } from '../../../../src/context/AIContext';
import { ScanProvider } from '../../../../src/context/ScanContext';
import { AlertProvider } from '../../../../src/context/AlertContext';
import { ToastProvider } from '../../../../src/context/ToastContext';
import { mockIpcRenderer } from '../../../frontend/setup';

// Helper component to test context
function TestComponent() {
    const { people, loadPeople, loading } = usePeople();

    useEffect(() => {
        loadPeople();
    }, [loadPeople]);

    if (loading) return <div data-testid="loading">Loading...</div>;
    return (
        <div>
            <div data-testid="count">{people.length}</div>
            <ul>
                {people.map(p => <li key={p.id}>{p.name}</li>)}
            </ul>
        </div>
    );
}

describe('PeopleContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should load people from IPC on start', async () => {
        // Arrange
        const mockPeople = [
            { id: 1, name: 'Alice', face_count: 5 },
            { id: 2, name: 'Bob', face_count: 3 }
        ];
        mockIpcRenderer.invoke.mockResolvedValue(mockPeople);

        // Act
        render(
            <PeopleProvider>
                <TestComponent />
            </PeopleProvider>
        );

        // Assert
        expect(screen.getByTestId('loading')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByTestId('count')).toHaveTextContent('2');
        });

        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('db:getPeople');
    });

    it('should handle errors during load gracefully', async () => {
        // Arrange
        vi.spyOn(console, 'error').mockImplementation(() => { });
        mockIpcRenderer.invoke.mockRejectedValue(new Error('IPC Failure'));

        // Act
        render(
            <PeopleProvider>
                <TestComponent />
            </PeopleProvider>
        );

        // Assert
        await waitFor(() => {
            expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
        });
        expect(screen.getByTestId('count')).toHaveTextContent('0');
        expect(console.error).toHaveBeenCalledWith('Failed to load people', expect.any(Error));
    });
});
