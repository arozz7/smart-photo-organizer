import { describe, it, expect } from 'vitest';
import { QuietGate } from '../../../../electron/core/services/QuietGate';

function setup(quietMs = 10_000) {
    let time = 0;
    const gate = new QuietGate(quietMs, () => time);
    return { gate, at: (ms: number) => (time = ms) };
}

describe('QuietGate', () => {
    it('is not quiet at the first quiet moment: the busy flag drops for a moment between two photos of a scan', () => {
        const { gate } = setup();

        expect(gate.isQuiet(false)).toBe(false);
    });

    it('becomes quiet after the full stretch without work', () => {
        const { gate, at } = setup();
        gate.isQuiet(false);

        at(9_999);
        expect(gate.isQuiet(false)).toBe(false);
        at(10_000);
        expect(gate.isQuiet(false)).toBe(true);
    });

    it('starts the stretch again whenever work shows up', () => {
        const { gate, at } = setup();
        gate.isQuiet(false);
        at(8_000);
        expect(gate.isQuiet(true)).toBe(false);

        at(12_000);
        expect(gate.isQuiet(false)).toBe(false); // 12 s after the first quiet moment, but 0 s after the interruption
        at(22_000);
        expect(gate.isQuiet(false)).toBe(true);
    });

    it('is quiet at once with a stretch of zero', () => {
        const { gate } = setup(0);

        expect(gate.isQuiet(false)).toBe(true);
        expect(gate.isQuiet(true)).toBe(false);
    });
});
