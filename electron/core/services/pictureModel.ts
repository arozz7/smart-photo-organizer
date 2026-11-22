import { logitForLikelihood } from './visibilityModel';

/**
 * The model-based "only a picture of a face" ranking (docs/measurements/pictures.md, section 4).
 *
 * The vision model's answer to "a real, living person, or only a picture of one?" (the log-odds of PICTURE against REAL: higher means
 * more picture-like) becomes the log-odds that a face is a picture: slope * answer + intercept. Fitted (logistic regression) on the faces
 * the user reviewed, with the same wording, crop (3.5 times the box) and precision as the engine uses. One question is enough: adding
 * the frame question or the detector score changed nothing (cross-validated AUC 0.95).
 * Changing the wording, the crop or the model means new weights AND a new PICTURE_MODEL name, so old scores are not mixed with new ones.
 */

/** Names the model, its question and the crop (stored with every score). Keep in step with FACE_PICTURE_PROMPT in src/python/config.py. */
export const PICTURE_MODEL = 'smolvlm2-picture-q1-v1';

export const PICTURE_WEIGHTS = {
    slope: 4.782,
    intercept: 10.347,
} as const;

/** Log-odds that a face is only a picture, from the model's answer. */
export function pictureLogit(modelScore: number): number {
    return PICTURE_WEIGHTS.slope * modelScore + PICTURE_WEIGHTS.intercept;
}

/** The model answer at which the likelihood of "picture" is `percent`. */
export function q1ForLikelihood(percent: number): number {
    return (logitForLikelihood(percent) - PICTURE_WEIGHTS.intercept) / PICTURE_WEIGHTS.slope;
}
