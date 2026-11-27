import { describe, it, expect } from 'vitest';
import { classifyDetection } from '../../../../electron/core/services/detectionTier';

const NORMAL_BOX = { width: 200, height: 220 };
const ACCEPT = 0.7;

describe('classifyDetection', () => {
    it('accepts a clear detection of a normal box as a human face', () => {
        expect(classifyDetection(0.95, NORMAL_BOX, ACCEPT)).toBe('human');
    });

    it('accepts a score exactly at the accept line', () => {
        expect(classifyDetection(0.7, NORMAL_BOX, ACCEPT)).toBe('human');
    });

    it('marks a weaker detection as suspect (it still has to pass the vision check)', () => {
        expect(classifyDetection(0.69, NORMAL_BOX, ACCEPT)).toBe('suspect');
        expect(classifyDetection(0.31, NORMAL_BOX, ACCEPT)).toBe('suspect');
    });

    it('marks a box that is much wider or taller than a face as suspect, however high the score', () => {
        expect(classifyDetection(0.95, { width: 330, height: 200 }, ACCEPT)).toBe('suspect');
        expect(classifyDetection(0.95, { width: 100, height: 200 }, ACCEPT)).toBe('suspect');
    });

    it('marks a very large box as suspect (it may hold several faces)', () => {
        expect(classifyDetection(0.95, { width: 2100, height: 2000 }, ACCEPT)).toBe('suspect');
    });

    it('follows the accept line it is given (strict mode raises it)', () => {
        expect(classifyDetection(0.72, NORMAL_BOX, 0.75)).toBe('suspect');
    });
});
