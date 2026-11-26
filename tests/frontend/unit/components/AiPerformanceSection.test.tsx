/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/components/SettingsModal', () => ({ default: () => null }));

import AiPerformanceSection from '../../../../src/components/settings/AiPerformanceSection';

const baseProps = {
    aiProfile: 'high' as const,
    vlmEnabled: true,
    captionTiming: 'background' as const,
    backgroundDuringScan: false,
    onProfileChange: vi.fn(),
    onVlmToggle: vi.fn(),
    onCaptionTimingChange: vi.fn(),
    onBackgroundDuringScanChange: vi.fn(),
};

describe('AiPerformanceSection: background tasks while scanning', () => {
    it('is off by default, so scans keep the engine to themselves', () => {
        render(<AiPerformanceSection {...baseProps} />);

        expect((screen.getByLabelText('Run background tasks while scanning') as HTMLInputElement).checked).toBe(false);
    });

    it('shows the saved choice', () => {
        render(<AiPerformanceSection {...baseProps} backgroundDuringScan={true} />);

        expect((screen.getByLabelText('Run background tasks while scanning') as HTMLInputElement).checked).toBe(true);
    });

    it('reports the new choice', () => {
        const onBackgroundDuringScanChange = vi.fn();
        render(<AiPerformanceSection {...baseProps} onBackgroundDuringScanChange={onBackgroundDuringScanChange} />);

        fireEvent.click(screen.getByLabelText('Run background tasks while scanning'));

        expect(onBackgroundDuringScanChange).toHaveBeenCalledWith(true);
    });

    it('is offered whether or not Smart Tags are on (face checks and grouping are background tasks too)', () => {
        render(<AiPerformanceSection {...baseProps} vlmEnabled={false} />);

        expect(screen.getByLabelText('Run background tasks while scanning')).toBeTruthy();
    });
});

describe('AiPerformanceSection: when descriptions and tags are made', () => {
    it('offers "in the background" (the default) and "while scanning" when Smart Tags are on', () => {
        render(<AiPerformanceSection {...baseProps} />);

        const select = screen.getByLabelText('When to make descriptions and tags') as HTMLSelectElement;

        expect(select.value).toBe('background');
        expect(Array.from(select.options).map(option => option.value)).toEqual(['background', 'scan']);
    });

    it('reports the choice', () => {
        const onCaptionTimingChange = vi.fn();
        render(<AiPerformanceSection {...baseProps} onCaptionTimingChange={onCaptionTimingChange} />);

        fireEvent.change(screen.getByLabelText('When to make descriptions and tags'), { target: { value: 'scan' } });

        expect(onCaptionTimingChange).toHaveBeenCalledWith('scan');
    });

    it('hides the choice while Smart Tags are off (there is nothing to time)', () => {
        render(<AiPerformanceSection {...baseProps} vlmEnabled={false} />);

        expect(screen.queryByLabelText('When to make descriptions and tags')).toBeNull();
    });
});
