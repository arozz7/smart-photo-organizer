/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
    scan: { scanning: true },
    progress: null as null | { phase: 'collecting' | 'processing'; done: number; total: number; folder: string },
    ai: { isProcessing: true, processingQueue: [1, 2, 3] as unknown[], scanMetrics: null as null | { load: number; scan: number; tag: number; total: number; lastUpdate: number } },
}));
vi.mock('../../../../src/context/ScanContext', () => ({ useScan: () => state.scan }));
vi.mock('../../../../src/context/AIContext', () => ({ useAI: () => state.ai }));
vi.mock('../../../../src/hooks/useScanProgress', () => ({ useScanProgress: () => ({ progress: state.progress, elapsedMs: 40_000 }) }));

import ScanEntertainmentWidget from '../../../../src/components/dashboard/ScanEntertainmentWidget';

const LABELS = ['Photos Scanned', 'AI Queue', 'Faces Found', 'Avg Speed'];
const shownLabels = () => LABELS.filter(label => screen.queryByText(label) !== null);

describe('ScanEntertainmentWidget', () => {
    beforeEach(() => {
        state.scan = { scanning: true };
        state.progress = { phase: 'processing', done: 412, total: 5354, folder: 'R:\\Pictures\\2013\\Orlando Trip\\April 07' };
        state.ai = { isProcessing: true, processingQueue: [1, 2, 3], scanMetrics: null };
    });

    it('shows how far the scan is: a bar with the percentage, and done of total with the folder', () => {
        render(<ScanEntertainmentWidget memories={[]} />);

        expect(screen.getByRole('progressbar', { name: 'Scan progress' }).getAttribute('aria-valuenow')).toBe('412');
        expect(screen.getByText(/412 of 5,354/)).toBeTruthy();
        expect(screen.getByText(/April 07/)).toBeTruthy();
    });

    it('shows an empty bar and no text before any progress arrives', () => {
        state.progress = null;
        render(<ScanEntertainmentWidget memories={[]} />);

        expect(screen.getByRole('progressbar', { name: 'Scan progress' }).getAttribute('aria-valuenow')).toBe('0');
        expect(screen.queryByText(/ of /)).toBeNull();
    });

    it('shows the same rows before the first metrics arrive, with them, and when the scan has finished, so the cards below it do not jump', () => {
        const { rerender } = render(<ScanEntertainmentWidget memories={[]} />);
        expect(shownLabels()).toEqual(LABELS);

        state.ai = { ...state.ai, scanMetrics: { load: 1, scan: 250, tag: 1, total: 1800, lastUpdate: 1 } };
        rerender(<ScanEntertainmentWidget memories={[]} />);
        expect(shownLabels()).toEqual(LABELS);

        state.scan = { scanning: false };
        state.ai = { ...state.ai, isProcessing: false };
        rerender(<ScanEntertainmentWidget memories={[]} />);
        expect(shownLabels()).toEqual(LABELS);
    });

    it('shows a dash for a number that is not known yet', () => {
        render(<ScanEntertainmentWidget memories={[]} />);

        expect(screen.getAllByText('—').length).toBe(2);
    });

    it('keeps room for the "Scan finished" line while scanning (hidden, not removed)', () => {
        const { rerender } = render(<ScanEntertainmentWidget memories={[]} />);
        const line = screen.getByText(/Scan finished/);
        expect(line.className).toContain('invisible');

        state.scan = { scanning: false };
        state.ai = { ...state.ai, isProcessing: false };
        rerender(<ScanEntertainmentWidget memories={[]} />);

        expect(screen.getByText(/Scan finished/).className).not.toContain('invisible');
    });
});
