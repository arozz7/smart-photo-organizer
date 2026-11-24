/**
 * @vitest-environment happy-dom
 */
import { renderHook, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useSelectionShortcuts } from '../../../../src/hooks/useSelectionShortcuts';

function setup(extra: Partial<Parameters<typeof useSelectionShortcuts>[0]> = {}) {
    const actions = { selectAll: vi.fn(), selectNone: vi.fn(), loadMoreAndSelect: vi.fn() };
    const view = renderHook(() => useSelectionShortcuts({ ...actions, hasSelection: true, canLoadMore: true, ...extra }));
    return { actions, ...view };
}

describe('useSelectionShortcuts', () => {
    it('Ctrl+A selects all loaded faces and stops the browser selecting the page', () => {
        const { actions } = setup();

        const notCancelled = fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

        expect(actions.selectAll).toHaveBeenCalledTimes(1);
        expect(notCancelled).toBe(false);
    });

    it('Cmd+A works the same on a Mac keyboard', () => {
        const { actions } = setup();

        fireEvent.keyDown(window, { key: 'A', metaKey: true });

        expect(actions.selectAll).toHaveBeenCalledTimes(1);
    });

    it('Escape clears the selection, but only when there is one', () => {
        const { actions, unmount } = setup();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(actions.selectNone).toHaveBeenCalledTimes(1);
        unmount();

        const none = setup({ hasSelection: false });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(none.actions.selectNone).not.toHaveBeenCalled();
    });

    it('L loads the next page and selects it, when there is one', () => {
        const { actions, unmount } = setup();
        fireEvent.keyDown(window, { key: 'l' });
        expect(actions.loadMoreAndSelect).toHaveBeenCalledTimes(1);
        unmount();

        const last = setup({ canLoadMore: false });
        fireEvent.keyDown(window, { key: 'l' });
        expect(last.actions.loadMoreAndSelect).not.toHaveBeenCalled();
    });

    it('ignores the keys while the user types in a field or uses a drop-down', () => {
        const { actions } = setup();
        const input = document.createElement('input');
        const select = document.createElement('select');
        document.body.append(input, select);

        fireEvent.keyDown(input, { key: 'l' });
        fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
        fireEvent.keyDown(select, { key: 'Escape' });

        expect(actions.loadMoreAndSelect).not.toHaveBeenCalled();
        expect(actions.selectAll).not.toHaveBeenCalled();
        expect(actions.selectNone).not.toHaveBeenCalled();
    });

    it('ignores L with Ctrl or Alt held, and keys another part of the page already handled', () => {
        const { actions } = setup();

        fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'l', altKey: true });
        const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
        handled.preventDefault();
        window.dispatchEvent(handled);

        expect(actions.loadMoreAndSelect).not.toHaveBeenCalled();
        expect(actions.selectNone).not.toHaveBeenCalled();
    });

    it('stops listening when the list is closed', () => {
        const { actions, unmount } = setup();
        unmount();

        fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

        expect(actions.selectAll).not.toHaveBeenCalled();
    });
});
