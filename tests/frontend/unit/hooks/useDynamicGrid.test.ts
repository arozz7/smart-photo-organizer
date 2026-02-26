/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDynamicGrid } from '../../../../src/hooks/useDynamicGrid';
import { ToastProvider } from '../../../../src/context/ToastContext';

// Minimal wrapper — only ToastProvider is needed by useDynamicGrid
const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(ToastProvider, null, children)
);

const STORAGE_PREFIX = 'spo:grid:';

describe('useDynamicGrid', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    function render(storageKey: string, defaultCols: number, min?: number, max?: number) {
        return renderHook(
            () => useDynamicGrid({ storageKey, default: defaultCols, min, max }),
            { wrapper }
        );
    }

    it('initializes with default when no localStorage value exists', () => {
        const { result } = render('testView', 8);
        expect(result.current.cols).toBe(8);
    });

    it('initializes from localStorage when a persisted value exists', () => {
        localStorage.setItem(`${STORAGE_PREFIX}testView`, '10');
        const { result } = render('testView', 8);
        expect(result.current.cols).toBe(10);
    });

    it('falls back to default when localStorage value is not a number', () => {
        localStorage.setItem(`${STORAGE_PREFIX}testView`, 'invalid');
        const { result } = render('testView', 8);
        expect(result.current.cols).toBe(8);
    });

    it('clamps stored value to GRID_MAX (12)', () => {
        localStorage.setItem(`${STORAGE_PREFIX}testView`, '99');
        const { result } = render('testView', 8);
        expect(result.current.cols).toBe(12);
    });

    it('clamps stored value to GRID_MIN (4)', () => {
        localStorage.setItem(`${STORAGE_PREFIX}testView`, '1');
        const { result } = render('testView', 8);
        expect(result.current.cols).toBe(4);
    });

    it('returns a containerRef callback function', () => {
        const { result } = render('testView', 8);
        expect(result.current.containerRef).toBeDefined();
        expect(typeof result.current.containerRef).toBe('function');
    });

    it('returns gridStyle with display:grid and correct gridTemplateColumns', () => {
        const { result } = render('testView', 8);
        expect(result.current.gridStyle.display).toBe('grid');
        expect(result.current.gridStyle.gridTemplateColumns).toBe('repeat(8, minmax(0, 1fr))');
        expect(result.current.gridStyle.gap).toBe('0.5rem');
    });

    it('gridStyle reflects the persisted column count on load', () => {
        localStorage.setItem(`${STORAGE_PREFIX}testView2`, '6');
        const { result } = render('testView2', 8);
        expect(result.current.gridStyle.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
    });

    it('respects custom min option — clamps stored value up to custom min', () => {
        localStorage.setItem(`${STORAGE_PREFIX}minTest`, '2');
        const { result } = render('minTest', 8, 6, 12);
        expect(result.current.cols).toBe(6);
    });

    it('respects custom max option — clamps stored value down to custom max', () => {
        localStorage.setItem(`${STORAGE_PREFIX}maxTest`, '15');
        const { result } = render('maxTest', 8, 4, 10);
        expect(result.current.cols).toBe(10);
    });

    it('each storageKey is independent — different views do not share state', () => {
        localStorage.setItem(`${STORAGE_PREFIX}viewA`, '6');
        localStorage.setItem(`${STORAGE_PREFIX}viewB`, '10');

        const hookA = renderHook(() => useDynamicGrid({ storageKey: 'viewA', default: 8 }), { wrapper });
        const hookB = renderHook(() => useDynamicGrid({ storageKey: 'viewB', default: 8 }), { wrapper });

        expect(hookA.result.current.cols).toBe(6);
        expect(hookB.result.current.cols).toBe(10);
    });
});
