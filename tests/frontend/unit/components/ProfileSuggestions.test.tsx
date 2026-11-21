/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProfileSuggestions from '../../../../src/components/ProfileSuggestions';
import type { ProfileFaceTile, ProfileOverview, ProfileRow } from '../../../../src/hooks/useProfileSuggestions';

const faceTile = (faceId: number, yaw: number | null = 62): ProfileFaceTile => ({
    faceId, photoId: faceId * 10, box: { x: 1, y: 2, width: 3, height: 4 }, yaw, quality: 0.5, blur: 100,
    filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100,
});
const row = (faceId: number, personId: number, extra: Partial<ProfileRow> = {}): ProfileRow => ({
    faceId, photoId: faceId * 10, tile: faceTile(faceId),
    person: { personId, name: `Name${personId}`, distance: 0.82 }, also: null, examples: [faceTile(900 + personId), faceTile(910 + personId)], frontal: faceTile(950 + personId, 3), ...extra,
});
const overview = (extra: Partial<ProfileOverview> = {}): ProfileOverview => ({
    state: 'ready', checked: 100, candidates: 100, examples: 430, peopleWithExamples: 24, total: 3, twoNames: 1,
    byPerson: [{ personId: 10, name: 'Name10', count: 2 }, { personId: 11, name: 'Name11', count: 1 }], assignedFromList: 0, stale: false,
    settings: { distance: 1.0, defaultDistance: 1.0, minDistance: 0.8, maxDistance: 1.1, distanceChoices: [0.8, 0.9, 1.0, 1.1], minYaw: 40, defaultMinYaw: 40, minYawAllowed: 40, maxYawAllowed: 70 },
    ...extra,
});

function makeCtrl(extra: Record<string, unknown> = {}) {
    return {
        overview: overview(),
        rows: [row(1, 10), row(2, 10, { also: { personId: 12, name: 'Name12', distance: 0.97 } }), row(3, 11)],
        total: 3, hasMore: false, loading: false, busy: false, selectedIds: new Set<number>(), undoBatch: null as number[] | null,
        loadMore: vi.fn(), toggle: vi.fn(), selectAllLoaded: vi.fn(), selectNone: vi.fn(), assignSelected: vi.fn(), assignTo: vi.fn(), dismissSelected: vi.fn(),
        undoLast: vi.fn(), setDistance: vi.fn(), setMinYaw: vi.fn(), refresh: vi.fn(), ...extra,
    };
}

const setup = (extra: Record<string, unknown> = {}, props: { personName?: string | null; onShowEveryone?: () => void } = {}) => {
    const ctrl = makeCtrl(extra);
    const onViewPhoto = vi.fn();
    render(<ProfileSuggestions ctrl={ctrl as never} onViewPhoto={onViewPhoto} personName={props.personName ?? null} onShowEveryone={props.onShowEveryone ?? vi.fn()} />);
    return { ctrl, onViewPhoto };
};

describe('ProfileSuggestions', () => {
    it('groups the faces under the suggested person, with the number of faces', () => {
        setup();

        expect(screen.getByRole('heading', { name: /Name10/ })).toHaveTextContent('2 faces');
        expect(screen.getByRole('heading', { name: /Name11/ })).toHaveTextContent('1 face');
    });

    it('shows the distance and pose of each face and says nothing is assigned until the user chooses', () => {
        setup();

        expect(screen.getAllByText(/0\.82/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/62° turned/).length).toBeGreaterThan(0);
        expect(screen.getByText(/nothing is assigned until you choose/i)).toBeInTheDocument();
    });

    it('shows both names of a face that is close to two people, and assigns the other name on request', () => {
        const { ctrl } = setup();

        const card = screen.getByTestId('profile-row-2');
        expect(within(card).getByText(/Also close to Name12/)).toBeInTheDocument();
        fireEvent.click(within(card).getByRole('button', { name: /It.s Name12/ }));

        expect(ctrl.assignTo).toHaveBeenCalledWith(2, 12);
        expect(within(screen.getByTestId('profile-row-1')).queryByRole('button', { name: /It.s/ })).toBeNull();
    });

    it('selects a face by clicking it, and selects all loaded from the bar above the list', () => {
        const { ctrl } = setup();

        fireEvent.click(screen.getByTestId('profile-face-1'));
        fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }));

        expect(ctrl.toggle).toHaveBeenCalledWith(1);
        expect(ctrl.selectAllLoaded).toHaveBeenCalled();
        expect(screen.getByText(/skips faces with two names/i)).toBeInTheDocument();
    });

    it('offers Assign selected and "Not this person" once faces are selected', () => {
        const { ctrl } = setup({ selectedIds: new Set([1, 3]) });

        fireEvent.click(screen.getByRole('button', { name: /Assign selected/ }));
        fireEvent.click(screen.getByRole('button', { name: /Not this person/ }));

        expect(ctrl.assignSelected).toHaveBeenCalled();
        expect(ctrl.dismissSelected).toHaveBeenCalled();
    });

    it('offers Undo after an assignment', () => {
        const { ctrl } = setup({ undoBatch: [1, 2] });

        expect(screen.getByText(/Assigned 2 faces/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        expect(ctrl.undoLast).toHaveBeenCalled();
    });

    it('changes the distance and the angle', () => {
        const { ctrl } = setup();

        fireEvent.change(screen.getByLabelText(/Distance up to/), { target: { value: '0.9' } });
        fireEvent.change(screen.getByLabelText(/Turned from/), { target: { value: '50' } });

        expect(ctrl.setDistance).toHaveBeenCalledWith(0.9);
        expect(ctrl.setMinYaw).toHaveBeenCalledWith(50);
    });

    it('says the search is running, with its progress, instead of an empty list', () => {
        setup({ overview: overview({ state: 'computing', checked: 40, candidates: 100, total: 0 }), rows: [], total: 0 });

        expect(screen.getByText(/Comparing turned faces/)).toHaveTextContent('40 of 100');
        expect(screen.queryByText(/No turned faces/)).toBeNull();
    });

    it('explains when nobody has turned examples yet', () => {
        setup({ overview: overview({ examples: 0, peopleWithExamples: 0, total: 0, byPerson: [], twoNames: 0 }), rows: [], total: 0 });

        expect(screen.getByText(/No one has confirmed turned faces yet/)).toBeInTheDocument();
    });

    it('shows a failed search with a way to try again', () => {
        const { ctrl } = setup({ overview: overview({ state: 'error', error: 'disk gone' }), rows: [], total: 0 });

        expect(screen.getByText(/disk gone/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Search again/ }));

        expect(ctrl.refresh).toHaveBeenCalled();
    });

    it('highlights Refresh after an assignment, since the examples grew', () => {
        setup({ overview: overview({ stale: true }) });

        expect(screen.getByText(/more turned faces may now match/i)).toBeInTheDocument();
    });

    it('limits the page to one person and lets the user go back to everyone', () => {
        const onShowEveryone = vi.fn();
        setup({}, { personName: 'Name10', onShowEveryone });

        fireEvent.click(screen.getByRole('button', { name: /Show everyone/ }));

        expect(screen.getByText(/Showing turned faces suggested for Name10/)).toBeInTheDocument();
        expect(onShowEveryone).toHaveBeenCalled();
    });

    it('opens the original photo from a face', () => {
        const { onViewPhoto } = setup();

        fireEvent.click(within(screen.getByTestId('profile-row-1')).getByTitle('View Original Photo'));

        expect(onViewPhoto).toHaveBeenCalledWith(10);
    });
});
