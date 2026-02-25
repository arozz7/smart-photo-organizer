/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GridSizeProvider, useGridSize } from '../../../../src/context/GridSizeContext';

const baseGridStyle = {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
    gap: '0.5rem',
};

describe('GridSizeContext', () => {
    it('useGridSize returns the provided cols value', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <GridSizeProvider value={{ cols: 8, gridStyle: baseGridStyle }}>
                {children}
            </GridSizeProvider>
        );
        const { result } = renderHook(() => useGridSize(), { wrapper });
        expect(result.current.cols).toBe(8);
    });

    it('useGridSize returns the provided gridStyle', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <GridSizeProvider value={{ cols: 8, gridStyle: baseGridStyle }}>
                {children}
            </GridSizeProvider>
        );
        const { result } = renderHook(() => useGridSize(), { wrapper });
        expect(result.current.gridStyle).toEqual(baseGridStyle);
    });

    it('useGridSize reflects value when different cols are provided', () => {
        const gridStyle12 = { ...baseGridStyle, gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' };

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <GridSizeProvider value={{ cols: 12, gridStyle: gridStyle12 }}>
                {children}
            </GridSizeProvider>
        );
        const { result } = renderHook(() => useGridSize(), { wrapper });
        expect(result.current.cols).toBe(12);
        expect(result.current.gridStyle.gridTemplateColumns).toBe('repeat(12, minmax(0, 1fr))');
    });

    it('useGridSize throws when used outside GridSizeProvider', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => {
            renderHook(() => useGridSize());
        }).toThrow('useGridSize must be used within a GridSizeProvider');
        consoleSpy.mockRestore();
    });

    it('nested GridSizeProviders use the nearest ancestor value', () => {
        const outer = { cols: 4, gridStyle: { ...baseGridStyle, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } };
        const inner = { cols: 10, gridStyle: { ...baseGridStyle, gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' } };

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <GridSizeProvider value={outer}>
                <GridSizeProvider value={inner}>
                    {children}
                </GridSizeProvider>
            </GridSizeProvider>
        );
        const { result } = renderHook(() => useGridSize(), { wrapper });
        expect(result.current.cols).toBe(10); // nearest provider wins
    });
});
