import { describe, it, expect } from 'vitest';
import {
    VISIBILITY_MODEL,
    VISIBILITY_WEIGHTS,
    rankingLogit,
    likelihoodOf,
    logitForLikelihood,
    LIKELIHOOD_CHOICES,
    MIN_LIKELIHOOD,
    MAX_LIKELIHOOD,
} from '../../../../electron/core/services/visibilityModel';

describe('visibilityModel', () => {
    it('names the model and its weights together, so scores from another wording are not mixed in', () => {
        expect(VISIBILITY_MODEL).toMatch(/^smolvlm2-visible-face-v\d+$/);
        expect(VISIBILITY_WEIGHTS.model).toBeGreaterThan(0);
        expect(VISIBILITY_WEIGHTS.detector).toBeLessThan(0);
    });

    describe('likelihood', () => {
        it('turns the ranking number into a probability between 0 and 1', () => {
            expect(likelihoodOf(0)).toBe(0.5);
            expect(likelihoodOf(50)).toBeGreaterThan(0.999);
            expect(likelihoodOf(-50)).toBeLessThan(0.001);
        });

        it('is the inverse of logitForLikelihood', () => {
            for (const percent of [10, 50, 70, 90, 95]) {
                expect(likelihoodOf(logitForLikelihood(percent)) * 100).toBeCloseTo(percent, 6);
            }
        });

        it('rises with the model score and falls with the detector score', () => {
            expect(rankingLogit(3, 0.4)).toBeGreaterThan(rankingLogit(1, 0.4));
            expect(rankingLogit(1, 0.2)).toBeGreaterThan(rankingLogit(1, 0.6));
        });

        it('calls an obvious non-face likely and a clear face unlikely', () => {
            // a box the detector hardly believes in, and the model sees no face
            expect(likelihoodOf(rankingLogit(4, 0.2))).toBeGreaterThan(0.9);
            // a confident detection with a clear face
            expect(likelihoodOf(rankingLogit(-2.5, 0.9))).toBeLessThan(0.05);
        });
    });

    describe('cut-offs', () => {
        it('offers likelihood choices inside the allowed range, in rising order', () => {
            expect([...LIKELIHOOD_CHOICES]).toEqual([...LIKELIHOOD_CHOICES].sort((a, b) => a - b));
            for (const choice of LIKELIHOOD_CHOICES) {
                expect(choice).toBeGreaterThanOrEqual(MIN_LIKELIHOOD);
                expect(choice).toBeLessThanOrEqual(MAX_LIKELIHOOD);
            }
        });

        it('turns a percentage into the ranking number to compare with', () => {
            expect(logitForLikelihood(50)).toBeCloseTo(0, 9);
            expect(logitForLikelihood(90)).toBeCloseTo(Math.log(9), 9);
        });
    });
});
