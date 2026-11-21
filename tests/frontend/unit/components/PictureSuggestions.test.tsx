/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PictureSuggestions from '../../../../src/components/PictureSuggestions';
import type { PictureOverview, PictureTile } from '../../../../src/hooks/usePictureSuggestions';

const tile = (faceId: number, extra: Partial<PictureTile> = {}): PictureTile => ({
    faceId, score: -1.5, likelihood: 85, quality: 0.6, blur: 100, yaw: 5, box: { x: 1, y: 2, width: 3, height: 4 }, photoId: faceId * 10,
    filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, personId: null, personName: null, source: null, confirmed: null, ...extra,
});

const overview = (extra: Partial<PictureOverview> = {}): PictureOverview => ({
    list: 'unassigned', minLikelihood: 70, defaultLikelihood: 70, minAllowed: 50, maxAllowed: 95,
    choices: [
        { likelihood: 50, unassigned: 1020, assigned: 3 },
        { likelihood: 70, unassigned: 680, assigned: 1 },
        { likelihood: 90, unassigned: 280, assigned: 0 },
    ],
    current: { total: 680 }, suggestedTotal: 681, checked: 4200, candidates: 71000, assignedChecked: 12340, assignedCandidates: 12340,
    ignoredFromList: 0, hideFromReview: true, hideable: 680, hiddenFromReview: 680, ...extra,
});

function makeCtrl(extra: Record<string, unknown> = {}) {
    return {
        overview: overview(), tiles: [tile(1), tile(2), tile(3)], total: 681, hasMore: false, loading: false, busy: false,
        selectedIds: new Set<number>(), undoBatch: null as number[] | null,
        loadMore: vi.fn(), toggle: vi.fn(), selectAllLoaded: vi.fn(), selectNone: vi.fn(), ignoreSelected: vi.fn(), keepSelected: vi.fn(), undoLast: vi.fn(),
        setList: vi.fn(), setLikelihood: vi.fn(), setHideFromReview: vi.fn(), ...extra,
    };
}

const setup = (extra: Record<string, unknown> = {}) => {
    const ctrl = makeCtrl(extra);
    const onViewPhoto = vi.fn();
    render(<PictureSuggestions ctrl={ctrl as never} onViewPhoto={onViewPhoto} />);
    return { ctrl, onViewPhoto };
};

describe('PictureSuggestions', () => {
    it('says what the list is and that nothing is changed until the user chooses', () => {
        setup();

        expect(screen.getByText(/680 faces are suggested/)).toBeInTheDocument();
        expect(screen.getByText(/only a picture of a face/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing is ignored until you choose/i)).toBeInTheDocument();
    });

    it('switches between the two lists, showing how many faces each holds at this likelihood', () => {
        const { ctrl } = setup();

        expect(screen.getByRole('button', { name: /In Review Needed \(680\)/ })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: /Assigned to a person \(1\)/ }));

        expect(ctrl.setList).toHaveBeenCalledWith('assigned');
    });

    it('chooses the likelihood, each choice shown with its count for the list shown', () => {
        const { ctrl } = setup();

        const select = screen.getByLabelText(/Likely a picture, at least/);
        expect(screen.getByRole('option', { name: '90% (280 faces)' })).toBeInTheDocument();
        fireEvent.change(select, { target: { value: '90' } });

        expect(ctrl.setLikelihood).toHaveBeenCalledWith(90);
    });

    it('shows how far the check has got and that the assigned faces come first', () => {
        setup();

        expect(screen.getByText(/checked 4,200 of 71,000 faces/i)).toBeInTheDocument();
        expect(screen.getByText(/12,340 of 12,340 assigned faces/i)).toBeInTheDocument();
    });

    it('turns hiding from Review Needed off and on', () => {
        const { ctrl } = setup();

        const box = screen.getByRole('checkbox', { name: /Hide these faces from Review Needed/ });
        expect(box).toBeChecked();
        expect(screen.getByText(/680 faces are hidden there/)).toBeInTheDocument();
        fireEvent.click(box);

        expect(ctrl.setHideFromReview).toHaveBeenCalledWith(false);
    });

    it('does not offer to hide anything on the assigned list: those faces are not in Review Needed', () => {
        setup({ overview: overview({ list: 'assigned', current: { total: 1 } }) });

        expect(screen.queryByRole('checkbox', { name: /Hide these faces from Review Needed/ })).toBeNull();
    });

    it('shows each face with its likelihood and selects it on click', () => {
        const { ctrl } = setup();

        expect(screen.getByTestId('picture-tile-1')).toHaveTextContent('85%');
        fireEvent.click(screen.getByTestId('picture-tile-2'));

        expect(ctrl.toggle).toHaveBeenCalledWith(2);
    });

    it('shows the person and how an assigned face was assigned', () => {
        setup({
            overview: overview({ list: 'assigned', current: { total: 1 } }),
            tiles: [tile(8, { personId: 10, personName: 'Mimi', source: 'auto_rematch', confirmed: false })],
        });

        const card = screen.getByTestId('picture-tile-8');
        expect(card).toHaveTextContent('Mimi');
        expect(card).toHaveTextContent(/re-match/i);
        expect(card).toHaveTextContent(/not confirmed/i);
    });

    it('offers Ignore as picture and Keep once faces are selected, with the right words for each list', () => {
        const { ctrl } = setup({ selectedIds: new Set([1]) });

        fireEvent.click(screen.getByRole('button', { name: /Ignore as picture/ }));
        fireEvent.click(screen.getByRole('button', { name: /Keep \(real face\)/ }));

        expect(ctrl.ignoreSelected).toHaveBeenCalled();
        expect(ctrl.keepSelected).toHaveBeenCalled();
    });

    it('says an assigned face is taken out of its person when ignored', () => {
        setup({ overview: overview({ list: 'assigned', current: { total: 1 } }), tiles: [tile(8, { personId: 10, personName: 'Mimi', source: 'ai_scan', confirmed: true })], selectedIds: new Set([8]) });

        expect(screen.getByText(/taken out of the person/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Remove from person and ignore as picture/ })).toBeInTheDocument();
    });

    it('offers Undo after an ignore', () => {
        const { ctrl } = setup({ undoBatch: [1, 2] });

        expect(screen.getByText(/Ignored 2 faces/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        expect(ctrl.undoLast).toHaveBeenCalled();
    });

    it('says when nothing is suggested at this likelihood', () => {
        setup({ tiles: [], overview: overview({ current: { total: 0 } }) });

        expect(screen.getByText(/No faces reach this likelihood yet/)).toBeInTheDocument();
    });

    it('opens the original photo from a tile', () => {
        const { onViewPhoto } = setup();

        fireEvent.click(within1('picture-tile-1').getByTitle('View Original Photo'));

        expect(onViewPhoto).toHaveBeenCalledWith(10);
    });
});

function within1(testId: string) {
    const element = screen.getByTestId(testId);
    return { getByTitle: (title: string) => element.querySelector(`[title="${title}"]`) as HTMLElement };
}
