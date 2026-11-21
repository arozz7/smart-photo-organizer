/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
    scan: { scanning: true, scanCount: 12 },
    ai: { isProcessing: true, processingQueue: [1, 2, 3] as unknown[], scanMetrics: null as null | { load: number; scan: number; tag: number; total: number; lastUpdate: number } },
}));
vi.mock('../../../../src/context/ScanContext', () => ({ useScan: () => state.scan }));
vi.mock('../../../../src/context/AIContext', () => ({ useAI: () => state.ai }));

import ScanEntertainmentWidget from '../../../../src/components/dashboard/ScanEntertainmentWidget';

const LABELS = ['Photos Scanned', 'AI Queue', 'Faces Found', 'Avg Speed'];
const shownLabels = () => LABELS.filter(label => screen.queryByText(label) !== null);

describe('ScanEntertainmentWidget', () => {
    beforeEach(() => {
        state.scan = { scanning: true, scanCount: 12 };
        state.ai = { isProcessing: true, processingQueue: [1, 2, 3], scanMetrics: null };
    });

    it('shows the same rows before the first metrics arrive, with them, and when the scan has finished, so the cards below it do not jump', () => {
        const { rerender } = render(<ScanEntertainmentWidget memories={[]} />);
        expect(shownLabels()).toEqual(LABELS);

        state.ai = { ...state.ai, scanMetrics: { load: 1, scan: 250, tag: 1, total: 1800, lastUpdate: 1 } };
        rerender(<ScanEntertainmentWidget memories={[]} />);
        expect(shownLabels()).toEqual(LABELS);

        state.scan = { scanning: false, scanCount: 12 };
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

        state.scan = { scanning: false, scanCount: 12 };
        state.ai = { ...state.ai, isProcessing: false };
        rerender(<ScanEntertainmentWidget memories={[]} />);

        expect(screen.getByText(/Scan finished/).className).not.toContain('invisible');
    });
});
