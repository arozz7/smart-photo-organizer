import { describe, it, expect } from 'vitest';
import { PICTURE_MODEL, PICTURE_WEIGHTS, pictureLogit, q1ForLikelihood } from '../../../../electron/core/services/pictureModel';
import { likelihoodOf } from '../../../../electron/core/services/visibilityModel';

describe('pictureModel', () => {
    it('names the model, its question and its crop together, so scores from another wording are not mixed in', () => {
        expect(PICTURE_MODEL).toMatch(/^smolvlm2-picture-q1-v\d+$/);
        expect(PICTURE_WEIGHTS.slope).toBeGreaterThan(0);
    });

    it('turns the model answer into log-odds that the face is only a picture (a higher answer is more picture-like)', () => {
        expect(pictureLogit(-1)).toBeGreaterThan(pictureLogit(-3));
        expect(likelihoodOf(pictureLogit(-4))).toBeLessThan(0.01);
        expect(likelihoodOf(pictureLogit(0))).toBeGreaterThan(0.99);
    });

    it('finds the model answer where the likelihood reaches a percentage, and back (the measured cut-offs: 70% at about -1.99)', () => {
        for (const percent of [50, 60, 70, 80, 90]) {
            expect(likelihoodOf(pictureLogit(q1ForLikelihood(percent))) * 100).toBeCloseTo(percent, 6);
        }
        expect(q1ForLikelihood(70)).toBeCloseTo(-1.99, 1);
        expect(q1ForLikelihood(50)).toBeCloseTo(-2.16, 1);
    });
});
