/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useListSelection } from '../../../../src/hooks/useListSelection';

const ids = [1, 2, 3, 4, 5, 6];
const selected = (result: { current: { selectedIds: Set<number> } }) => [...result.current.selectedIds].sort((a, b) => a - b);

describe('useListSelection', () => {
    it('toggles one face on and off', () => {
        const { result } = renderHook(() => useListSelection(ids));

        act(() => result.current.toggle(2));
        expect(selected(result)).toEqual([2]);
        act(() => result.current.toggle(2));
        expect(selected(result)).toEqual([]);
    });

    it('selects the range from the last plain click to a shift-click, adding to what is selected', () => {
        const { result } = renderHook(() => useListSelection(ids));
        act(() => result.current.toggle(6));
        act(() => result.current.toggle(2));

        act(() => result.current.toggle(4, true));

        expect(selected(result)).toEqual([2, 3, 4, 6]);
    });

    it('keeps the anchor for a second shift-click, so the range can be adjusted', () => {
        const { result } = renderHook(() => useListSelection(ids));
        act(() => result.current.toggle(2));
        act(() => result.current.toggle(5, true));

        act(() => result.current.toggle(3, true));

        expect(selected(result)).toEqual([2, 3, 4, 5]);
    });

    it('treats a shift-click with no anchor as a plain click', () => {
        const { result } = renderHook(() => useListSelection(ids));

        act(() => result.current.toggle(3, true));

        expect(selected(result)).toEqual([3]);
    });

    it('treats a shift-click as a plain click when the anchor has left the list', () => {
        const { result, rerender } = renderHook(({ list }) => useListSelection(list), { initialProps: { list: ids } });
        act(() => result.current.toggle(2));

        rerender({ list: [3, 4, 5] });
        act(() => result.current.toggle(5, true));

        expect(selected(result)).toEqual([2, 5]);
    });

    it('selects all faces in the list, or none', () => {
        const { result } = renderHook(() => useListSelection(ids));

        act(() => result.current.selectAllLoaded());
        expect(selected(result)).toEqual(ids);
        act(() => result.current.selectNone());
        expect(selected(result)).toEqual([]);
    });

    it('adds faces to the selection without changing the others (the page just loaded)', () => {
        const { result } = renderHook(() => useListSelection(ids));
        act(() => result.current.toggle(1));

        act(() => result.current.addToSelection([5, 6]));

        expect(selected(result)).toEqual([1, 5, 6]);
    });

    it('forgets the anchor when the selection is cleared', () => {
        const { result } = renderHook(() => useListSelection(ids));
        act(() => result.current.toggle(2));
        act(() => result.current.selectNone());

        act(() => result.current.toggle(5, true));

        expect(selected(result)).toEqual([5]);
    });
});
