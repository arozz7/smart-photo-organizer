/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../../setup';
import ActionDropdown, { ActionDropdownItem } from '../../../../../src/components/ui/ActionDropdown';

// ResizeObserver mock
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('ActionDropdown', () => {
    const mockItems: ActionDropdownItem[] = [
        { label: 'Action 1', onClick: vi.fn() },
        { label: 'Action 2', onClick: vi.fn(), variant: 'primary' },
        { label: 'Danger Action', onClick: vi.fn(), variant: 'danger' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the onClick mocks for each item
        mockItems.forEach(item => {
            (item.onClick as ReturnType<typeof vi.fn>).mockClear();
        });
    });

    it('renders trigger button with label', () => {
        render(<ActionDropdown label="More Actions" items={mockItems} />);

        expect(screen.getByText('More Actions')).toBeInTheDocument();
        expect(screen.getByTestId('action-dropdown-trigger')).toBeInTheDocument();
    });

    it('opens dropdown menu on trigger click', () => {
        render(<ActionDropdown label="More Actions" items={mockItems} />);

        // Initially, menu should not be visible
        expect(screen.queryByTestId('action-dropdown-menu')).not.toBeInTheDocument();

        // Click trigger
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));

        // Menu should now be visible
        expect(screen.getByTestId('action-dropdown-menu')).toBeInTheDocument();
        expect(screen.getByText('Action 1')).toBeInTheDocument();
        expect(screen.getByText('Action 2')).toBeInTheDocument();
        expect(screen.getByText('Danger Action')).toBeInTheDocument();
    });

    it('closes dropdown on second trigger click (toggle)', () => {
        render(<ActionDropdown label="More Actions" items={mockItems} />);

        // Open
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));
        expect(screen.getByTestId('action-dropdown-menu')).toBeInTheDocument();

        // Close
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));
        expect(screen.queryByTestId('action-dropdown-menu')).not.toBeInTheDocument();
    });

    it('closes dropdown on outside click', () => {
        render(
            <div>
                <div data-testid="outside-element">Outside</div>
                <ActionDropdown label="More Actions" items={mockItems} />
            </div>
        );

        // Open
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));
        expect(screen.getByTestId('action-dropdown-menu')).toBeInTheDocument();

        // Click outside
        fireEvent.mouseDown(screen.getByTestId('outside-element'));
        expect(screen.queryByTestId('action-dropdown-menu')).not.toBeInTheDocument();
    });

    it('closes dropdown on ESC key', () => {
        render(<ActionDropdown label="More Actions" items={mockItems} />);

        // Open
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));
        expect(screen.getByTestId('action-dropdown-menu')).toBeInTheDocument();

        // Press ESC
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('action-dropdown-menu')).not.toBeInTheDocument();
    });

    it('calls onClick handler for menu items and closes menu', () => {
        const onClick1 = vi.fn();
        const onClick2 = vi.fn();
        const items: ActionDropdownItem[] = [
            { label: 'Item 1', onClick: onClick1 },
            { label: 'Item 2', onClick: onClick2 },
        ];

        render(<ActionDropdown label="Actions" items={items} />);

        // Open menu
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));

        // Click first item
        fireEvent.click(screen.getByText('Item 1'));

        expect(onClick1).toHaveBeenCalledTimes(1);
        expect(onClick2).not.toHaveBeenCalled();

        // Menu should be closed
        expect(screen.queryByTestId('action-dropdown-menu')).not.toBeInTheDocument();
    });

    it('disables items with disabled prop', () => {
        const onClick = vi.fn();
        const items: ActionDropdownItem[] = [
            { label: 'Disabled Item', onClick, disabled: true },
        ];

        render(<ActionDropdown label="Actions" items={items} />);

        // Open menu
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));

        const disabledItem = screen.getByText('Disabled Item');
        expect(disabledItem.closest('button')).toBeDisabled();

        // Click should not trigger onClick
        fireEvent.click(disabledItem);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('shows loading state for loading items', () => {
        const items: ActionDropdownItem[] = [
            { label: 'Loading Item', onClick: vi.fn(), loading: true },
        ];

        render(<ActionDropdown label="Actions" items={items} />);

        // Open menu
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));

        // The button should be disabled when loading
        const loadingItem = screen.getByText('Loading Item').closest('button');
        expect(loadingItem).toBeDisabled();
    });

    it('renders icons when provided', () => {
        const TestIcon = () => <span data-testid="test-icon">🔧</span>;
        const items: ActionDropdownItem[] = [
            { label: 'With Icon', onClick: vi.fn(), icon: <TestIcon /> },
        ];

        render(<ActionDropdown label="Actions" items={items} />);

        // Open menu
        fireEvent.click(screen.getByTestId('action-dropdown-trigger'));

        expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('applies custom testId', () => {
        render(<ActionDropdown label="Actions" items={mockItems} testId="custom-dropdown" />);

        expect(screen.getByTestId('custom-dropdown')).toBeInTheDocument();
        expect(screen.getByTestId('custom-dropdown-trigger')).toBeInTheDocument();
    });

    it('toggles rotation class on chevron when open', () => {
        render(<ActionDropdown label="Actions" items={mockItems} />);

        const trigger = screen.getByTestId('action-dropdown-trigger');
        const chevron = trigger.querySelector('svg');

        // Initially not rotated
        expect(chevron).not.toHaveClass('rotate-180');

        // Open - should rotate
        fireEvent.click(trigger);
        expect(chevron).toHaveClass('rotate-180');
    });
});
