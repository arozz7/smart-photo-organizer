/**
 * The model-based "not a face" ranking (docs/measurements/non-face-and-picture-faces.md, Phase B part 2).
 *
 * The vision model's answer (higher = "no clear face visible") and the detector's own score are combined into one number,
 * the log-odds that a box is not a face: model * wModel + detector * wDetector + intercept. The weights were fitted
 * (logistic regression, 480 faces the user reviewed, 48 of them non-faces) with the same wording, crop and precision as the engine uses
 * (docs/measurements/non-face-and-picture-faces.md, section 8, wording C).
 * Changing the question wording, the crop or the model means new weights AND a new VISIBILITY_MODEL name, so old scores
 * are not mixed with new ones (they stay in the database and are simply not used).
 */

/** Names the model, its question and the crop (stored with every score). Keep in step with FACE_VISIBILITY_PROMPT in src/python/config.py. */
export const VISIBILITY_MODEL = 'smolvlm2-visible-face-v1';

export const VISIBILITY_WEIGHTS = {
    model: 1.123,
    detector: -7.312,
    intercept: 2.126,
} as const;

/** The likelihoods (percent) the list offers as cut-offs, and the range the setting accepts. */
export const LIKELIHOOD_CHOICES = [50, 60, 70, 80, 90] as const;
export const MIN_LIKELIHOOD = 50;
export const MAX_LIKELIHOOD = 95;
export const DEFAULT_LIKELIHOOD = 70;

/** Log-odds that a box is not a face. */
export function rankingLogit(modelScore: number, detectorScore: number): number {
    return VISIBILITY_WEIGHTS.model * modelScore + VISIBILITY_WEIGHTS.detector * detectorScore + VISIBILITY_WEIGHTS.intercept;
}

/** The probability (0 to 1) for a ranking number. */
export function likelihoodOf(logit: number): number {
    return 1 / (1 + Math.exp(-logit));
}

/** The ranking number at which the likelihood is `percent`. */
export function logitForLikelihood(percent: number): number {
    const p = percent / 100;
    return Math.log(p / (1 - p));
}
