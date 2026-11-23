/**
 * @vitest-environment happy-dom
 *
 * The Smart Assignment section is no longer shown in Settings; its behaviour is kept under test for the planned redesign.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const showAlert = vi.fn();
vi.mock('../../../../src/context/AlertContext', () => ({ useAlert: () => ({ showAlert }) }));

import SmartAssignmentSection from '../../../../src/components/settings/SmartAssignmentSection';

function installIpc(result: unknown) {
    const invoke = vi.fn(async () => result);
    Object.defineProperty(window, 'ipcRenderer', { value: { invoke }, writable: true });
    return invoke;
}

describe('SmartAssignmentSection', () => {
    afterEach(() => { cleanup(); showAlert.mockReset(); });

    it('runs batch propagation and shows the result', async () => {
        const invoke = installIpc({ success: true, propagated: 3, skipped: 1 });
        render(<SmartAssignmentSection />);

        fireEvent.click(screen.getByRole('button', { name: 'Run for Entire Library' }));

        await waitFor(() => expect(screen.getByText(/Done — 3 faces assigned/)).toBeInTheDocument());
        expect(invoke).toHaveBeenCalledWith('db:batchPropagateLabels');
    });

    it('says nothing was assigned when propagation is switched off, instead of "Done"', async () => {
        installIpc({ success: true, propagated: 0, skipped: 0, disabled: true, message: 'Nothing was assigned. Being redesigned.' });
        render(<SmartAssignmentSection />);

        fireEvent.click(screen.getByRole('button', { name: 'Run for Entire Library' }));

        await waitFor(() => expect(screen.getByText('Nothing was assigned. Being redesigned.')).toBeInTheDocument());
        expect(screen.queryByText(/Done —/)).not.toBeInTheDocument();
    });

    it('alerts when batch propagation fails', async () => {
        installIpc({ success: false, error: 'boom' });
        render(<SmartAssignmentSection />);

        fireEvent.click(screen.getByRole('button', { name: 'Run for Entire Library' }));

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Propagation Failed', description: 'boom', variant: 'danger' })));
    });
});
