/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VisibilityStatus } from '../../../../src/hooks/useFaceVisibility';

const hook = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../../../src/hooks/useFaceVisibility', () => ({ useFaceVisibility: () => hook.value }));

import { FaceVisibilityCard } from '../../../../src/components/FaceVisibilityCard';
import { describeState } from '../../../../src/utils/visibilityText';

const status = (extra: Partial<VisibilityStatus> = {}): VisibilityStatus => ({
    mode: 'away', awayMinutes: 5, state: 'waiting-away', candidates: 1000, scored: 98, failed: 2, remaining: 900, lastError: null, ...extra,
});

function setup(current: VisibilityStatus | null, message: string | null = null) {
    const actions = { runNow: vi.fn(), setMode: vi.fn(), setAwayMinutes: vi.fn() };
    hook.value = { status: current, message, ...actions };
    render(<FaceVisibilityCard />);
    return actions;
}

beforeEach(() => { hook.value = {}; });

describe('describeState', () => {
    it.each([
        [{ state: 'off' }, 'Switched off.'],
        [{ state: 'done' }, 'Every uncertain face has been checked.'],
        [{ state: 'waiting-busy' }, 'Paused: a scan or AI work is running.'],
        [{ state: 'waiting-away', awayMinutes: 1 }, 'Waiting until you have been away for 1 minute.'],
        [{ state: 'waiting-away', awayMinutes: 10 }, 'Waiting until you have been away for 10 minutes.'],
        [{ state: 'scoring' }, 'Checking faces...'],
    ] as [Partial<VisibilityStatus>, string][])('says what %j means', (extra, text) => {
        expect(describeState(status(extra))).toBe(text);
    });

    it('shows the error and how to recover', () => {
        const text = describeState(status({ state: 'error', lastError: 'A GPU is required for this check' }));

        expect(text).toContain('A GPU is required for this check');
        expect(text).toContain('Run now');
    });
});

describe('FaceVisibilityCard', () => {
    it('shows progress, failures and what it is doing', () => {
        setup(status());

        expect(screen.getByText(/100 of 1,000 uncertain faces checked \(2 could not be read\)/)).toBeTruthy();
        expect(screen.getByText(/Waiting until you have been away for 5 minutes/)).toBeTruthy();
    });

    it('says plainly that it only ranks suggestions', () => {
        setup(status());

        expect(screen.getByText(/nothing is ignored or changed by it/i)).toBeTruthy();
    });

    it('changes the run mode and the away time', () => {
        const actions = setup(status());

        fireEvent.change(screen.getByLabelText('When to run'), { target: { value: 'always' } });
        fireEvent.change(screen.getByLabelText('Minutes away'), { target: { value: '15' } });

        expect(actions.setMode).toHaveBeenCalledWith('always');
        expect(actions.setAwayMinutes).toHaveBeenCalledWith(15);
    });

    it('only offers the away time in "away" mode', () => {
        setup(status({ mode: 'always' }));

        expect(screen.queryByLabelText('Minutes away')).toBeNull();
    });

    it('runs now', () => {
        const actions = setup(status());

        fireEvent.click(screen.getByText('Run now'));

        expect(actions.runNow).toHaveBeenCalled();
    });

    it('cannot run now while checking or when nothing is left', () => {
        setup(status({ state: 'scoring' }));
        expect((screen.getByText('Checking...') as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables Run now when nothing is left', () => {
        setup(status({ state: 'done', remaining: 0 }));

        expect((screen.getByText('Run now') as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows a message from the last action', () => {
        setup(status(), 'A scan or AI work is running. Try again when it has finished.');

        expect(screen.getByText(/A scan or AI work is running/)).toBeTruthy();
    });

    it('renders before the status has loaded, with the controls disabled', () => {
        setup(null);

        expect((screen.getByLabelText('When to run') as HTMLSelectElement).disabled).toBe(true);
        expect((screen.getByText('Run now') as HTMLButtonElement).disabled).toBe(true);
    });
});
