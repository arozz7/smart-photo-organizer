/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NonFaceSuggestions from '../../../../src/components/NonFaceSuggestions';
import { describePose } from '../../../../src/utils/nonFacePose';
import type { NonFaceTile, NonFaceOverview } from '../../../../src/hooks/useNonFaceSuggestions';

const tile = (faceId: number, extra: Partial<NonFaceTile> = {}): NonFaceTile => ({
    faceId, score: 0.31, quality: 0.6, blur: 100, yaw: 10, pitch: 0, box: { x: 1, y: 2, width: 3, height: 4 },
    photoId: faceId * 10, filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, ...extra,
});

const overview = (extra: Partial<NonFaceOverview> = {}): NonFaceOverview => ({
    mode: 'detector',
    current: { total: 3846, turned: 819 },
    detector: {
        cutoff: 0.55, defaultCutoff: 0.55, minCutoff: 0.3, maxCutoff: 0.75,
        choices: [
            { cutoff: 0.5, total: 3000, turned: 600 },
            { cutoff: 0.55, total: 3846, turned: 819 },
            { cutoff: 0.6, total: 4500, turned: 900 },
        ],
    },
    model: null,
    ignoredFromList: 0, hideFromReview: true, hideable: 3027, hiddenFromReview: 3027, ...extra,
});

const modelOverview = (extra: Partial<NonFaceOverview> = {}): NonFaceOverview => overview({
    mode: 'model',
    current: { total: 2900, turned: 40 },
    detector: null,
    model: {
        minLikelihood: 70, defaultLikelihood: 70, minAllowed: 50, maxAllowed: 95, checked: 4200, candidates: 11000,
        choices: [{ likelihood: 50, total: 4000, turned: 300 }, { likelihood: 70, total: 2900, turned: 40 }, { likelihood: 90, total: 1500, turned: 5 }],
    },
    ...extra,
});

function makeCtrl(extra: Record<string, unknown> = {}) {
    return {
        overview: overview(), tiles: [tile(1), tile(2, { yaw: 62 }), tile(3, { yaw: null })], total: 3846, hasMore: false,
        loading: false, busy: false, selectedIds: new Set<number>(), undoBatch: null as number[] | null,
        loadMore: vi.fn(), toggle: vi.fn(), selectAllLoaded: vi.fn(), selectNone: vi.fn(),
        ignoreSelected: vi.fn(), keepSelected: vi.fn(), undoLast: vi.fn(), setCutoff: vi.fn(), setMode: vi.fn(), setLikelihood: vi.fn(), setHideFromReview: vi.fn(), ...extra,
    };
}

const setup = (extra: Record<string, unknown> = {}) => {
    const ctrl = makeCtrl(extra);
    const onViewPhoto = vi.fn();
    render(<NonFaceSuggestions ctrl={ctrl} onViewPhoto={onViewPhoto} />);
    return { ctrl, onViewPhoto };
};

describe('describePose', () => {
    it.each([
        [null, { text: 'pose unknown', turned: false }],
        [0, { text: '0°', turned: false }],
        [44, { text: '44°', turned: false }],
        [45, { text: '45° turned', turned: true }],
        [-62.4, { text: '62° turned', turned: true }],
    ])('describes a yaw of %s', (yaw, expected) => {
        expect(describePose(yaw)).toEqual(expected);
    });
});

describe('NonFaceSuggestions', () => {
    it('says what the list is, how many faces it holds, and that turned faces are real faces', () => {
        setup();

        expect(screen.getByText(/3,846 faces are suggested/)).toBeTruthy();
        expect(screen.getByText(/819 of them are turned 45° or more/)).toBeTruthy();
        expect(screen.getByText(/nothing is ignored until you choose/i)).toBeTruthy();
    });

    it('offers each cut-off with its count and saves a new choice', () => {
        const { ctrl } = setup();
        const select = screen.getByLabelText(/detector score below/i) as HTMLSelectElement;

        expect(within(select).getByText('0.60 (4,500 faces)')).toBeTruthy();
        expect(select.value).toBe('0.55');
        fireEvent.change(select, { target: { value: '0.6' } });

        expect(ctrl.setCutoff).toHaveBeenCalledWith(0.6);
    });

    it('switches between the detector list and the model list', () => {
        const { ctrl } = setup();

        fireEvent.click(screen.getByText('Model + detector'));
        fireEvent.click(screen.getByText('Detector score'));

        expect(ctrl.setMode).toHaveBeenCalledTimes(1);
        expect(ctrl.setMode).toHaveBeenCalledWith('model');
    });

    describe('model list', () => {
        it('offers the likelihood choices with their counts and saves a new choice', () => {
            const { ctrl } = setup({ overview: modelOverview(), total: 2900 });
            const select = screen.getByLabelText(/likely not a face, at least/i) as HTMLSelectElement;

            expect(within(select).getByText('90% (1,500 faces)')).toBeTruthy();
            expect(select.value).toBe('70');
            fireEvent.change(select, { target: { value: '90' } });

            expect(ctrl.setLikelihood).toHaveBeenCalledWith(90);
            expect(screen.queryByLabelText(/detector score below/i)).toBeNull();
        });

        it('says how much the model has looked at, and warns about turned faces', () => {
            setup({ overview: modelOverview(), total: 2900 });

            expect(screen.getByText(/looked at 4,200 of 11,000 uncertain faces/)).toBeTruthy();
            expect(screen.getByText(/leans against faces seen from the side/)).toBeTruthy();
            expect(screen.getByText(/40 of them are turned 45° or more/)).toBeTruthy();
        });

        it('shows the likelihood on each tile instead of the detector score', () => {
            setup({ overview: modelOverview(), total: 2900, tiles: [tile(1, { likelihood: 93.4, modelScore: 3.2, score: 0.2 })] });

            expect(screen.getByText('93%')).toBeTruthy();
            expect(screen.getByTestId('nonface-tile-1').getAttribute('title')).toContain('93% likely not a face');
            expect(screen.getByTestId('nonface-tile-1').getAttribute('title')).toContain('Detector score 0.20');
        });
    });

    it('shows score and pose on every tile, marking turned faces and unknown poses', () => {
        setup();

        expect(screen.getAllByText('0.31')).toHaveLength(3);
        expect(screen.getByText('10°')).toBeTruthy();
        expect(screen.getByText('62° turned')).toBeTruthy();
        expect(screen.getByText('pose unknown')).toBeTruthy();
    });

    it('selects a face by clicking it and can select all loaded faces or none', () => {
        const { ctrl } = setup();

        fireEvent.click(screen.getByTestId('nonface-tile-2'));
        fireEvent.click(screen.getByText('Select all loaded'));
        fireEvent.click(screen.getByText('Deselect'));

        expect(ctrl.toggle).toHaveBeenCalledWith(2);
        expect(ctrl.selectAllLoaded).toHaveBeenCalled();
        expect(ctrl.selectNone).toHaveBeenCalled();
    });

    it('opens the original photo without selecting the face', () => {
        const { ctrl, onViewPhoto } = setup();

        fireEvent.click(within(screen.getByTestId('nonface-tile-2')).getByTitle('View Original Photo'));

        expect(onViewPhoto).toHaveBeenCalledWith(20);
        expect(ctrl.toggle).not.toHaveBeenCalled();
    });

    it('shows the ignore and keep actions only while something is selected', () => {
        const none = setup();
        expect(screen.queryByText('Ignore selected')).toBeNull();
        expect(none.ctrl.ignoreSelected).not.toHaveBeenCalled();
    });

    it('ignores or keeps the selected faces', () => {
        const { ctrl } = setup({ selectedIds: new Set([1, 2]) });

        fireEvent.click(screen.getByText('Ignore selected'));
        fireEvent.click(screen.getByText('Keep (these are faces)'));

        expect(ctrl.ignoreSelected).toHaveBeenCalled();
        expect(ctrl.keepSelected).toHaveBeenCalled();
    });

    it('offers to undo the last ignore', () => {
        const { ctrl } = setup({ undoBatch: [1, 2, 3] });

        expect(screen.getByText(/Ignored 3 faces/)).toBeTruthy();
        fireEvent.click(screen.getByText('Undo'));

        expect(ctrl.undoLast).toHaveBeenCalled();
    });

    it('loads more when there are more faces than shown', () => {
        const { ctrl } = setup({ hasMore: true });

        fireEvent.click(screen.getByText('Load More'));

        expect(ctrl.loadMore).toHaveBeenCalled();
    });

    it('says so when nothing is suggested', () => {
        setup({ tiles: [], total: 0, overview: overview({ current: { cutoff: 0.55, total: 0, turned: 0 } }) });

        expect(screen.getByText(/no faces below this cut-off/i)).toBeTruthy();
    });

    it('disables the actions while one is running', () => {
        setup({ selectedIds: new Set([1]), busy: true });

        expect((screen.getByText('Ignore selected').closest('button') as HTMLButtonElement).disabled).toBe(true);
    });

    describe('hiding the list from Review Needed', () => {
        it('says what it does, with the number of faces, and that turned faces stay', () => {
            setup();

            expect(screen.getByRole('checkbox', { name: /Hide these faces from Review Needed/ })).toBeChecked();
            expect(screen.getByText(/3,027 faces are hidden there/)).toBeInTheDocument();
            expect(screen.getByText(/turned 45° or more stay in Review Needed/)).toBeInTheDocument();
        });

        it('turns it off', () => {
            const { ctrl } = setup();

            fireEvent.click(screen.getByRole('checkbox', { name: /Hide these faces from Review Needed/ }));

            expect(ctrl.setHideFromReview).toHaveBeenCalledWith(false);
        });

        it('shows it unchecked when it is off, with the number it would hide, and turns it on', () => {
            const { ctrl } = setup({ overview: overview({ hideFromReview: false, hiddenFromReview: 0, hideable: 3027 }) });

            const box = screen.getByRole('checkbox', { name: /Hide these faces from Review Needed/ });
            expect(box).not.toBeChecked();
            expect(screen.getByText(/3,027 faces would be hidden/)).toBeInTheDocument();
            fireEvent.click(box);
            expect(ctrl.setHideFromReview).toHaveBeenCalledWith(true);
        });

        it('cannot be changed while another change is being saved', () => {
            setup({ busy: true });

            expect(screen.getByRole('checkbox', { name: /Hide these faces from Review Needed/ })).toBeDisabled();
        });
    });
});
