/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DoubtfulFaces from '../../../../src/components/DoubtfulFaces';

vi.mock('../../../../src/components/FaceThumbnail', () => ({
    default: ({ box }: { box: { x: number; y: number; width: number; height: number } }) => <div data-testid="thumb" data-box={JSON.stringify(box)} />,
}));
import type { DoubtfulOverview, DoubtfulTile } from '../../../../src/hooks/useDoubtfulFaces';

const tile = (faceId: number, extra: Partial<DoubtfulTile> = {}): DoubtfulTile => ({
    faceId, score: 3.5, quality: 0.6, blur: 100, yaw: 5, box: { x: 1, y: 2, width: 3, height: 4 }, photoId: faceId * 10,
    filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, personId: 7, personName: 'Alex', source: 'profile_match', confirmed: true, ...extra,
});

const overview = (extra: Partial<DoubtfulOverview> = {}): DoubtfulOverview => ({
    minScore: 3, defaultMinScore: 3, minAllowed: 0, maxAllowed: 6,
    choices: [{ score: 1, total: 4200 }, { score: 3, total: 640 }, { score: 5, total: 90 }],
    current: { total: 640 },
    people: [{ personId: 7, name: 'Alex', count: 400 }, { personId: 8, name: 'Sam', count: 240 }],
    checked: 9000, candidates: 20379, changed: 0, ...extra,
});

function makeCtrl(extra: Record<string, unknown> = {}) {
    return {
        overview: overview(), tiles: [tile(1), tile(2), tile(3)], personId: null as number | null, total: 640, hasMore: false, loading: false, busy: false,
        selectedIds: new Set<number>(), undoBatch: null as { kind: 'ignore' | 'unassign'; faceIds: number[] } | null,
        loadMore: vi.fn(), loadMoreAndSelect: vi.fn(), toggle: vi.fn(), selectAllLoaded: vi.fn(), selectNone: vi.fn(),
        ignoreSelected: vi.fn(), unassignSelected: vi.fn(), keepSelected: vi.fn(), undoLast: vi.fn(), setPerson: vi.fn(), setMinScore: vi.fn(), ...extra,
    };
}

const setup = (extra: Record<string, unknown> = {}) => {
    const ctrl = makeCtrl(extra);
    const onViewPhoto = vi.fn();
    render(<DoubtfulFaces ctrl={ctrl as never} onViewPhoto={onViewPhoto} />);
    return { ctrl, onViewPhoto };
};

describe('DoubtfulFaces', () => {
    it('says what the list is and that nothing changes until the user chooses', () => {
        setup();

        expect(screen.getByText(/640 assigned faces are doubtful/)).toBeInTheDocument();
        expect(screen.getByText(/finds no clear face/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing is changed until you choose/i)).toBeInTheDocument();
    });

    it('crops each tile to the face itself, not to its surroundings', () => {
        setup({ tiles: [tile(1, { box: { x: 40, y: 30, width: 20, height: 25 }, photoWidth: 400, photoHeight: 300 })] });

        expect(JSON.parse(screen.getByTestId('thumb').getAttribute('data-box')!)).toEqual({ x: 40, y: 30, width: 20, height: 25 });
    });

    it('chooses the doubt level, each choice shown with its count', () => {
        const { ctrl } = setup();

        expect(screen.getByRole('option', { name: '5 (90 faces)' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Doubt level, at least/), { target: { value: '5' } });

        expect(ctrl.setMinScore).toHaveBeenCalledWith(5);
    });

    it('limits the list to one person, the one with the most doubtful faces first, and back to everyone', () => {
        const { ctrl } = setup();

        const select = screen.getByLabelText('Person');
        expect(Array.from((select as HTMLSelectElement).options).map(o => o.text)).toEqual(['Everyone (640)', 'Alex (400)', 'Sam (240)']);
        fireEvent.change(select, { target: { value: '8' } });
        fireEvent.change(select, { target: { value: '' } });

        expect(ctrl.setPerson).toHaveBeenNthCalledWith(1, 8);
        expect(ctrl.setPerson).toHaveBeenNthCalledWith(2, null);
    });

    it('shows how far the check has got and where to run it', () => {
        setup();

        expect(screen.getByText(/checked 9,000 of 20,379 assigned faces/i)).toBeInTheDocument();
        expect(screen.getByText(/Check Assigned Faces/)).toBeInTheDocument();
    });

    it('shows the person and how each face was assigned, and selects a face on click', () => {
        const { ctrl } = setup({ tiles: [tile(1, { confirmed: false, source: 'ai_scan' }), tile(2)] });

        expect(screen.getByText('by a scan, not confirmed')).toBeInTheDocument();
        expect(screen.getByText('from the Turned faces list, confirmed')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('doubtful-tile-1'));

        expect(ctrl.toggle).toHaveBeenCalledWith(1, false);
    });

    it('offers the three actions only when faces are selected, each doing its own thing', () => {
        const { ctrl } = setup({ selectedIds: new Set([1, 2]) });

        fireEvent.click(screen.getByRole('button', { name: /Keep \(real face\)/ }));
        fireEvent.click(screen.getByRole('button', { name: /Back to suggestions/ }));
        fireEvent.click(screen.getByRole('button', { name: /Not a face/ }));

        expect(ctrl.keepSelected).toHaveBeenCalledTimes(1);
        expect(ctrl.unassignSelected).toHaveBeenCalledTimes(1);
        expect(ctrl.ignoreSelected).toHaveBeenCalledTimes(1);
    });

    it('has no action bar while nothing is selected', () => {
        setup();

        expect(screen.queryByRole('button', { name: /Back to suggestions/ })).toBeNull();
    });

    it.each([
        ['ignore', /Ignored 2 faces as not faces/],
        ['unassign', /Moved 2 faces back to suggestions/],
    ] as const)('after a change (%s) says what was done and offers Undo', (kind, text) => {
        const { ctrl } = setup({ undoBatch: { kind, faceIds: [1, 2] } });

        expect(screen.getByText(text)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        expect(ctrl.undoLast).toHaveBeenCalledTimes(1);
    });

    it('says when no face reaches this doubt level yet', () => {
        setup({ tiles: [], overview: overview({ current: { total: 0 } }) });

        expect(screen.getByText(/No assigned faces reach this doubt level yet/)).toBeInTheDocument();
    });

    it('can load more faces when there are more', () => {
        const { ctrl } = setup({ hasMore: true });

        fireEvent.click(screen.getByRole('button', { name: 'Load More' }));

        expect(ctrl.loadMore).toHaveBeenCalled();
    });
});
