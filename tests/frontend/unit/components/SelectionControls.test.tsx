/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SelectionToolbar, LoadMoreControls, FloatingBarClearance } from '../../../../src/components/SelectionControls';

describe('SelectionToolbar', () => {
    const setup = () => {
        const actions = { onSelectAll: vi.fn(), onSelectNone: vi.fn() };
        render(<SelectionToolbar selectedCount={3} summary="showing 100 of 900" {...actions} />);
        return actions;
    };

    it('shows the count and a summary, and tells the user about shift-click and the keys', () => {
        setup();

        expect(screen.getByText(/3 selected/)).toBeInTheDocument();
        expect(screen.getByText(/showing 100 of 900/)).toBeInTheDocument();
        expect(screen.getByText(/Shift\+click selects a range/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Select all loaded/ })).toHaveAttribute('title', expect.stringContaining('Ctrl+A'));
        expect(screen.getByRole('button', { name: /Deselect/ })).toHaveAttribute('title', expect.stringContaining('Esc'));
    });

    it('selects all and deselects', () => {
        const actions = setup();

        fireEvent.click(screen.getByRole('button', { name: /Select all loaded/ }));
        fireEvent.click(screen.getByRole('button', { name: /Deselect/ }));

        expect(actions.onSelectAll).toHaveBeenCalled();
        expect(actions.onSelectNone).toHaveBeenCalled();
    });

    it('stays on screen while the user scrolls, so the controls are never far away', () => {
        setup();

        expect(screen.getByTestId('selection-toolbar').className).toContain('sticky');
    });
});

describe('LoadMoreControls', () => {
    it('offers Load More and Load more and select, and disables both while loading', () => {
        const onLoadMore = vi.fn();
        const onLoadMoreAndSelect = vi.fn();
        const { rerender } = render(<LoadMoreControls loading={false} onLoadMore={onLoadMore} onLoadMoreAndSelect={onLoadMoreAndSelect} />);

        fireEvent.click(screen.getByRole('button', { name: 'Load More' }));
        fireEvent.click(screen.getByRole('button', { name: /Load more and select/ }));
        expect(onLoadMore).toHaveBeenCalled();
        expect(onLoadMoreAndSelect).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Load more and select/ })).toHaveAttribute('title', expect.stringContaining('L'));

        rerender(<LoadMoreControls loading={true} onLoadMore={onLoadMore} onLoadMoreAndSelect={onLoadMoreAndSelect} />);
        expect(screen.getByRole('button', { name: 'Load More' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Load more and select/ })).toBeDisabled();
    });
});

describe('FloatingBarClearance', () => {
    it('leaves room under the list while the floating bar is shown, so Load More is never covered', () => {
        const { rerender } = render(<FloatingBarClearance active={true} />);
        expect(screen.getByTestId('bar-clearance')).toBeInTheDocument();

        rerender(<FloatingBarClearance active={false} />);
        expect(screen.queryByTestId('bar-clearance')).toBeNull();
    });
});
