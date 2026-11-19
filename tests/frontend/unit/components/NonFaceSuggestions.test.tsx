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
    cutoff: 0.55, defaultCutoff: 0.55, minCutoff: 0.3, maxCutoff: 0.75,
    current: { cutoff: 0.55, total: 3846, turned: 819 },
    choices: [
        { cutoff: 0.5, total: 3000, turned: 600 },
        { cutoff: 0.55, total: 3846, turned: 819 },
        { cutoff: 0.6, total: 4500, turned: 900 },
    ],
    ignoredFromList: 0, ...extra,
});

function makeCtrl(extra: Record<string, unknown> = {}) {
    return {
        overview: overview(), tiles: [tile(1), tile(2, { yaw: 62 }), tile(3, { yaw: null })], total: 3846, hasMore: false,
        loading: false, busy: false, selectedIds: new Set<number>(), undoBatch: null as number[] | null,
        loadMore: vi.fn(), toggle: vi.fn(), selectAllLoaded: vi.fn(), selectNone: vi.fn(),
        ignoreSelected: vi.fn(), keepSelected: vi.fn(), undoLast: vi.fn(), setCutoff: vi.fn(), ...extra,
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
});
