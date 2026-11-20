/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ people: [{ id: 7, name: 'Zeus' }] }) }));
vi.mock('../../../../src/components/NonFaceSuggestions', () => ({ default: () => <div>NON-FACE PANEL</div> }));
vi.mock('../../../../src/components/ProfileSuggestions', () => ({
    default: ({ personName }: { personName: string | null }) => <div>PROFILE PANEL {personName ?? 'everyone'}</div>,
}));

import EdgeCaseSuggestionPanels from '../../../../src/components/EdgeCaseSuggestionPanels';
import EdgeCaseFilters from '../../../../src/components/EdgeCaseFilters';

const suggestions = (focusPersonId: number | null = null) => ({ nonFace: {}, profile: {}, focusPersonId, showEveryone: vi.fn() }) as never;

describe('EdgeCaseSuggestionPanels', () => {
    it('shows the list of the open filter and nothing for the others', () => {
        const { rerender } = render(<EdgeCaseSuggestionPanels active="nonface" suggestions={suggestions()} onViewPhoto={vi.fn()} />);
        expect(screen.getByText('NON-FACE PANEL')).toBeInTheDocument();

        rerender(<EdgeCaseSuggestionPanels active="profile" suggestions={suggestions()} onViewPhoto={vi.fn()} />);
        expect(screen.getByText('PROFILE PANEL everyone')).toBeInTheDocument();

        rerender(<EdgeCaseSuggestionPanels active="ignored" suggestions={suggestions()} onViewPhoto={vi.fn()} />);
        expect(screen.queryByText(/PANEL/)).toBeNull();
    });

    it('names the person the turned faces are limited to', () => {
        render(<EdgeCaseSuggestionPanels active="profile" suggestions={suggestions(7)} onViewPhoto={vi.fn()} />);

        expect(screen.getByText('PROFILE PANEL Zeus')).toBeInTheDocument();
    });
});

describe('EdgeCaseFilters', () => {
    it('has a Turned faces tab with its count', () => {
        const onFilterChange = vi.fn();
        render(<EdgeCaseFilters activeFilter="unnamed" onFilterChange={onFilterChange} counts={{ unnamed: 1, ignored: 2, ungroupable: 3, background: 4, nonface: 5, profile: 1920 }} />);

        const tab = screen.getByRole('button', { name: /Turned faces/ });
        expect(tab).toHaveTextContent('1920');
        fireEvent.click(tab);

        expect(onFilterChange).toHaveBeenCalledWith('profile');
    });
});

describe('EdgeCaseFilters, faces hidden from Review Needed', () => {
    const counts = { unnamed: 100, ignored: 2, ungroupable: 3, background: 4, nonface: 5, profile: 6 };

    it('tells the user how many faces Review Needed leaves out, with a way to open them', () => {
        const onFilterChange = vi.fn();
        render(<EdgeCaseFilters activeFilter="unnamed" onFilterChange={onFilterChange} counts={{ ...counts, hidden: 1204 }} />);

        expect(screen.getByText(/1,204 faces are not shown here/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Review them in Not a Face\?/ }));

        expect(onFilterChange).toHaveBeenCalledWith('nonface');
    });

    it('says nothing when no face is hidden, or on the other filters', () => {
        const { rerender } = render(<EdgeCaseFilters activeFilter="unnamed" onFilterChange={vi.fn()} counts={{ ...counts, hidden: 0 }} />);
        expect(screen.queryByText(/not shown here/)).toBeNull();

        rerender(<EdgeCaseFilters activeFilter="ignored" onFilterChange={vi.fn()} counts={{ ...counts, hidden: 50 }} />);
        expect(screen.queryByText(/not shown here/)).toBeNull();
    });
});
