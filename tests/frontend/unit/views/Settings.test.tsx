/**
 * @vitest-environment happy-dom
 *
 * Characterization test for the Settings screen.
 * It pins current behaviour so the file can be split into smaller components
 * (Phase: settings refactor) without changing what the user sees or what is sent over IPC.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const showAlert = vi.fn();
const showConfirm = vi.fn();
const updateSmartIgnoreSettings = vi.fn();
const calculateBlurScores = vi.fn();

vi.mock('../../../../src/context/AlertContext', () => ({
    useAlert: () => ({ showAlert, showConfirm, promptUser: vi.fn() }),
}));
vi.mock('../../../../src/context/AIContext', () => ({
    useAI: () => ({ calculatingBlur: false, blurProgress: { current: 0, total: 0 }, calculateBlurScores }),
}));
vi.mock('../../../../src/context/PeopleContext', () => ({
    usePeople: () => ({
        smartIgnoreSettings: { enableAiSuggestions: true, aiSuggestionThreshold: 0.6, ungroupableDistanceThreshold: 1.0 },
        updateSmartIgnoreSettings,
    }),
}));

// Child components that own their own IPC and are covered elsewhere.
vi.mock('../../../../src/components/SettingsModal', () => ({
    default: ({ open }: { open: boolean }) => (open ? <div>Models Modal Open</div> : null),
}));
vi.mock('../../../../src/components/ScanWarningsModal', () => ({
    default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Warnings Modal Open</div> : null),
}));
vi.mock('../../../../src/components/FaceDataHealthCard', () => ({
    FaceDataHealthCard: () => <div>Face Data Health Card</div>,
}));
vi.mock('../../../../src/components/RematchCard', () => ({
    RematchCard: () => <div>Rematch Card</div>,
}));
vi.mock('../../../../src/components/PictureCheckCard', () => ({
    PictureCheckCard: () => <div>Picture Check Card</div>,
}));
vi.mock('../../../../src/components/FaceVisibilityCard', () => ({
    FaceVisibilityCard: () => <div>Face Visibility Card</div>,
}));
vi.mock('../../../../src/components/SendToSettingsCard', () => ({
    default: () => <div>Send To Settings Card</div>,
}));

import Settings from '../../../../src/views/Settings';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const AI_SETTINGS = { aiProfile: 'high', vlmEnabled: true, minFacesForEra: 120, eraMergeThreshold: 1.1, other: 'kept' };

function installIpc(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const responses: Record<string, (...args: unknown[]) => unknown> = {
        'settings:getLibraryPath': () => 'D:\\Library',
        'ai:getSettings': () => ({ ...AI_SETTINGS }),
        'ai:saveSettings': () => ({ success: true }),
        'settings:get': () => ({ prsExecutablePath: 'C:\\Tools\\prs.exe' }),
        'settings:getPreviewStats': () => ({ success: true, count: 12, size: 2048 }),
        ...overrides,
    };
    const invoke: Invoke = async (channel, ...args) => {
        calls.push({ channel, args });
        const handler = responses[channel];
        return handler ? handler(...args) : {};
    };
    Object.defineProperty(window, 'ipcRenderer', { value: { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn() }, writable: true });
    return calls;
}

const callsTo = (calls: Array<{ channel: string; args: unknown[] }>, channel: string) =>
    calls.filter(c => c.channel === channel);

describe('Settings view', () => {
    beforeEach(() => {
        showAlert.mockReset();
        showConfirm.mockReset();
        updateSmartIgnoreSettings.mockReset();
        calculateBlurScores.mockReset();
        localStorage.clear();
    });
    afterEach(() => cleanup());

    it('renders every section heading', async () => {
        installIpc();
        render(<Settings />);
        for (const heading of [
            'Library Storage', 'AI Performance Profile', 'Person Identification', 'Era Generation',
            'Preview Cache', 'Database Management', 'Integrations', 'Health & Logs',
        ]) {
            expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
        }
        expect(screen.queryByRole('heading', { name: 'Smart Assignment' })).not.toBeInTheDocument();
        expect(screen.getByText('Face Data Health Card')).toBeInTheDocument();
        expect(screen.getByText('Send To Settings Card')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('D:\\Library')).toBeInTheDocument());
    });

    it('shows the values loaded over IPC', async () => {
        installIpc();
        render(<Settings />);

        await waitFor(() => expect(screen.getByText('D:\\Library')).toBeInTheDocument());
        expect((screen.getByLabelText('AI model profile') as HTMLSelectElement).value).toBe('high');
        expect((screen.getByLabelText('When to make descriptions and tags') as HTMLSelectElement).value).toBe('background');
        expect(screen.getByText('ENABLED')).toBeInTheDocument();
        expect(screen.getByText('1.10')).toBeInTheDocument();
        expect(screen.getByText('120')).toBeInTheDocument();
        expect((screen.getByDisplayValue('C:\\Tools\\prs.exe') as HTMLInputElement).readOnly).toBe(true);
        await waitFor(() => expect(screen.getByText(/Files:/)).toBeInTheDocument());
        expect(localStorage.getItem('libraryPath')).toBe('D:\\Library');
    });

    it('saves the AI profile merged with the current settings, then offers a reload', async () => {
        const calls = installIpc();
        render(<Settings />);
        await waitFor(() => expect(screen.getByText('D:\\Library')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('AI model profile'), { target: { value: 'balanced' } });

        await waitFor(() => expect(callsTo(calls, 'ai:saveSettings')).toHaveLength(1));
        expect(callsTo(calls, 'ai:saveSettings')[0].args[0]).toEqual({ ...AI_SETTINGS, aiProfile: 'balanced' });
        await waitFor(() => expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reload Required', confirmLabel: 'Reload Now' })));
    });

    it('saves when descriptions and tags are made, merged with the current settings, with no reload', async () => {
        const calls = installIpc();
        render(<Settings />);
        await waitFor(() => expect(screen.getByText('D:\\Library')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('When to make descriptions and tags'), { target: { value: 'scan' } });

        await waitFor(() => expect(callsTo(calls, 'ai:saveSettings')).toHaveLength(1));
        expect(callsTo(calls, 'ai:saveSettings')[0].args[0]).toEqual({ ...AI_SETTINGS, captionTiming: 'scan' });
        expect(showConfirm).not.toHaveBeenCalled();
    });

    it('saves "run background tasks while scanning", merged with the current settings, with no reload', async () => {
        const calls = installIpc();
        render(<Settings />);
        await waitFor(() => expect(screen.getByText('D:\\Library')).toBeInTheDocument());

        fireEvent.click(screen.getByLabelText('Run background tasks while scanning'));

        await waitFor(() => expect(callsTo(calls, 'ai:saveSettings')).toHaveLength(1));
        expect(callsTo(calls, 'ai:saveSettings')[0].args[0]).toEqual({ ...AI_SETTINGS, backgroundDuringScan: true });
        expect(showConfirm).not.toHaveBeenCalled();
    });

    it('toggles Smart Tags, saves it merged and offers a reload', async () => {
        const calls = installIpc();
        render(<Settings />);
        await waitFor(() => expect(screen.getByText('ENABLED')).toBeInTheDocument());

        const toggle = screen.getByText('ENABLED').nextElementSibling as HTMLElement;
        fireEvent.click(toggle);

        await waitFor(() => expect(callsTo(calls, 'ai:saveSettings')).toHaveLength(1));
        expect(callsTo(calls, 'ai:saveSettings')[0].args[0]).toEqual({ ...AI_SETTINGS, vlmEnabled: false });
        expect(screen.getByText('DISABLED')).toBeInTheDocument();
        await waitFor(() => expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reload Required' })));
    });

    it('saves a changed era merge threshold and minimum faces, merged with current settings', async () => {
        const calls = installIpc();
        render(<Settings />);
        await waitFor(() => expect(screen.getByText('1.10')).toBeInTheDocument());

        const sliders = screen.getAllByRole('slider');
        const mergeSlider = sliders.find(s => (s as HTMLInputElement).max === '2.0')!;
        const minFacesSlider = sliders.find(s => (s as HTMLInputElement).max === '500')!;

        fireEvent.change(mergeSlider, { target: { value: '1.5' } });
        await waitFor(() => expect(callsTo(calls, 'ai:saveSettings')).toHaveLength(1));
        expect(callsTo(calls, 'ai:saveSettings')[0].args[0]).toEqual({ ...AI_SETTINGS, eraMergeThreshold: 1.5 });

        fireEvent.change(minFacesSlider, { target: { value: '200' } });
        await waitFor(() => expect(callsTo(calls, 'ai:saveSettings')).toHaveLength(2));
        expect(callsTo(calls, 'ai:saveSettings')[1].args[0]).toEqual({ ...AI_SETTINGS, minFacesForEra: 200 });
        expect(screen.getByText('1.50')).toBeInTheDocument();
        expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('forwards person identification changes to the people context', async () => {
        installIpc();
        render(<Settings />);
        await waitFor(() => expect(screen.getByText('D:\\Library')).toBeInTheDocument());

        const strength = screen.getAllByRole('slider').find(s => (s as HTMLInputElement).max === '0.85')!;
        fireEvent.change(strength, { target: { value: '0.7' } });

        expect(updateSmartIgnoreSettings).toHaveBeenCalledWith({ aiSuggestionThreshold: 0.7 });
    });

    it('asks for confirmation before clearing AI tags, then reports success', async () => {
        const calls = installIpc({ 'db:clearAITags': () => ({ success: true }) });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear Tags' }));

        expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clear AI Tags', variant: 'danger' }));
        expect(callsTo(calls, 'db:clearAITags')).toHaveLength(0);

        await showConfirm.mock.calls[0][0].onConfirm();

        expect(callsTo(calls, 'db:clearAITags')).toHaveLength(1);
        await waitFor(() => expect(screen.getByText('Successfully cleared all AI tags.')).toBeInTheDocument());
    });

    it('shows the failure message when clearing AI tags fails', async () => {
        installIpc({ 'db:clearAITags': () => ({ success: false, error: 'locked' }) });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear Tags' }));
        await showConfirm.mock.calls[0][0].onConfirm();

        await waitFor(() => expect(screen.getByText('Failed to clear tags: locked')).toBeInTheDocument());
    });

    it('runs tag cleanup only after confirmation and reports the counts', async () => {
        const calls = installIpc({ 'db:cleanupTags': () => ({ success: true, deletedCount: 4, mergedCount: 9 }) });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Cleanup Tags' }));
        expect(callsTo(calls, 'db:cleanupTags')).toHaveLength(0);
        expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cleanup Tags', variant: 'danger' }));

        await showConfirm.mock.calls[0][0].onConfirm();

        expect(callsTo(calls, 'db:cleanupTags')).toHaveLength(1);
        expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cleanup Complete', description: expect.stringContaining('Tags Deleted: 4') }));
    });

    it('removes duplicate faces only after confirmation', async () => {
        const calls = installIpc({ 'db:removeDuplicateFaces': () => ({ removedCount: 7 }) });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Deduplicate Faces' }));
        expect(callsTo(calls, 'db:removeDuplicateFaces')).toHaveLength(0);

        await showConfirm.mock.calls[0][0].onConfirm();

        expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ description: 'Removed 7 duplicate faces.' }));
    });

    it('keeps Factory Reset disabled until RESET is typed exactly, then resets', async () => {
        const calls = installIpc({ 'db:factoryReset': () => ({ success: true }) });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Factory Reset' }));
        const confirmButton = screen.getByRole('button', { name: 'Confirm Reset' });
        expect(confirmButton).toBeDisabled();

        const input = screen.getByPlaceholderText('Type RESET');
        fireEvent.change(input, { target: { value: 'reset' } });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(input, { target: { value: 'RESET' } });
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        await waitFor(() => expect(callsTo(calls, 'db:factoryReset')).toHaveLength(1));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset Complete' })));
    });

    it('closes the Factory Reset dialog on Cancel without resetting', async () => {
        const calls = installIpc();
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Factory Reset' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByPlaceholderText('Type RESET')).not.toBeInTheDocument();
        expect(callsTo(calls, 'db:factoryReset')).toHaveLength(0);
    });

    it('moves the library only after the folder dialog and confirmation, with a blocking modal meanwhile', async () => {
        let finishMove: (value: unknown) => void = () => undefined;
        const calls = installIpc({
            'dialog:openDirectory': () => 'E:\\NewLibrary',
            'settings:moveLibrary': () => new Promise(resolve => { finishMove = resolve; }),
        });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Move Library' }));
        await waitFor(() => expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move Library', confirmLabel: 'Move Library' })));
        expect(callsTo(calls, 'settings:moveLibrary')).toHaveLength(0);

        const pending = showConfirm.mock.calls[0][0].onConfirm();
        await waitFor(() => expect(screen.getByText('Moving Library...')).toBeInTheDocument());
        expect(callsTo(calls, 'settings:moveLibrary')[0].args[0]).toBe('E:\\NewLibrary');

        finishMove({ success: false, error: 'disk full' });
        await pending;

        await waitFor(() => expect(screen.queryByText('Moving Library...')).not.toBeInTheDocument());
        expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move Failed', description: 'disk full' }));
    });

    it('does nothing when the folder dialog is cancelled', async () => {
        installIpc({ 'dialog:openDirectory': () => null });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Move Library' }));
        await waitFor(() => expect(window.ipcRenderer.invoke).toBeDefined());

        expect(showConfirm).not.toHaveBeenCalled();
    });

    // A library move has its own blocking modal; it must not touch the Clear Tags busy state.
    it('keeps Clear Tags available after a failed library move', async () => {
        installIpc({
            'dialog:openDirectory': () => 'E:\\NewLibrary',
            'settings:moveLibrary': () => ({ success: false, error: 'disk full' }),
        });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Move Library' }));
        await waitFor(() => expect(showConfirm).toHaveBeenCalled());
        await showConfirm.mock.calls[0][0].onConfirm();

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move Failed' })));
        expect(screen.getByRole('button', { name: 'Clear Tags' })).toBeEnabled();
    });

    it('stores the chosen Photo Repair Shop executable', async () => {
        const calls = installIpc({ 'dialog:openFile': () => 'C:\\New\\prs.exe' });
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Browse...' }));

        await waitFor(() => expect(callsTo(calls, 'settings:update')).toHaveLength(1));
        expect(callsTo(calls, 'settings:update')[0].args[0]).toEqual({ prsExecutablePath: 'C:\\New\\prs.exe' });
        expect(screen.getByDisplayValue('C:\\New\\prs.exe')).toBeInTheDocument();
    });

    it('opens the models modal and the scan warnings modal', async () => {
        installIpc();
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Configure Models' }));
        expect(screen.getByText('Models Modal Open')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'View Warnings' }));
        expect(screen.getByText('Warnings Modal Open')).toBeInTheDocument();
    });

    it('confirms preview cache cleanup with the chosen age and reloads the stats', async () => {
        const calls = installIpc({ 'settings:cleanupPreviews': () => ({ success: true, deletedCount: 5, deletedSize: 1048576 }) });
        render(<Settings />);
        await waitFor(() => expect(screen.getByText(/Files:/)).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /Clear > 7 Days/ }));
        expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clear Preview Cache', variant: 'primary' }));

        await showConfirm.mock.calls[0][0].onConfirm();

        expect(callsTo(calls, 'settings:cleanupPreviews')[0].args[0]).toEqual({ days: 7 });
        expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cleanup Complete', description: 'Deleted: 5 files\nFreed: 1.00 MB' }));
        await waitFor(() => expect(callsTo(calls, 'settings:getPreviewStats').length).toBeGreaterThanOrEqual(2));
    });

    it('marks Clear All previews as a danger action', async () => {
        installIpc();
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));

        expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    });

    it('starts blur score calculation from the maintenance section', async () => {
        installIpc();
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: 'Calculate Scores' }));

        expect(calculateBlurScores).toHaveBeenCalledTimes(1);
    });
});
