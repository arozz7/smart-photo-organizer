/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VisibilityStatus } from '../../../../src/hooks/useFaceVisibility';

const hook = vi.hoisted(() => ({ value: {} as Record<string, unknown>, prefixes: [] as unknown[] }));
vi.mock('../../../../src/hooks/useFaceVisibility', () => ({ useFaceVisibility: (prefix?: string) => { hook.prefixes.push(prefix); return hook.value; } }));

import { PictureCheckCard } from '../../../../src/components/PictureCheckCard';

const status = (extra: Partial<VisibilityStatus> = {}): VisibilityStatus => ({
    mode: 'away', awayMinutes: 5, state: 'waiting-away', candidates: 71000, scored: 4000, failed: 20, remaining: 66980, lastError: null, ...extra,
});

function setup(current: VisibilityStatus | null) {
    const actions = { runNow: vi.fn(), setMode: vi.fn(), setAwayMinutes: vi.fn() };
    hook.value = { status: current, message: null, ...actions };
    render(<PictureCheckCard />);
    return actions;
}

beforeEach(() => { hook.value = {}; hook.prefixes = []; });

describe('PictureCheckCard', () => {
    it('is the check for pictures of faces, using its own channels, and says it only ranks suggestions', () => {
        setup(status());

        expect(screen.getByText('Check for Pictures of Faces')).toBeInTheDocument();
        expect(hook.prefixes.at(-1)).toBe('picturecheck');
        expect(screen.getByText(/billboard/i)).toBeInTheDocument();
        expect(screen.getByText(/assigned to people first/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing is ignored or changed by it/i)).toBeInTheDocument();
    });

    it('shows how many faces have been checked', () => {
        setup(status());

        expect(screen.getByText(/4,020 of 71,000 faces checked/)).toBeInTheDocument();
        expect(screen.getByText(/20 could not be read/)).toBeInTheDocument();
    });

    it('runs now, and chooses when to run (only when away by default)', () => {
        const actions = setup(status());

        fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
        fireEvent.change(screen.getByLabelText('When to run'), { target: { value: 'always' } });

        expect(actions.runNow).toHaveBeenCalled();
        expect(actions.setMode).toHaveBeenCalledWith('always');
        expect((screen.getByLabelText('When to run') as HTMLSelectElement).value).toBe('away');
    });

    it('says in plain words that every face has been checked when it is done', () => {
        setup(status({ state: 'done', remaining: 0 }));

        expect(screen.getByText('Every face has been checked.')).toBeInTheDocument();
    });
});
