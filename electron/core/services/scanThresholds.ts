import { STRICT_SCORE_THRESHOLD_ACCEPT } from './ConfigService';
import type { AISettings, AdvancedFaceConfig } from './ConfigService';

/** Every number the scan compares against, read from the settings in one place (a scan reads them once, not per face). */
export interface ScanThresholds {
    /** Match distance below which a face is assigned to a person. */
    autoAssign: number;
    /** Match distance below which a face is suggested for a person. */
    review: number;
    /** How far the search looks for candidates (a little beyond `review`). */
    searchCutoff: number;
    /** Detector score from which a detection counts as a sure face. */
    acceptScore: number;
    /** Detector score below which a detection is dropped (unless it is large, see `largeFaceWidth`). */
    rejectFloor: number;
    /** Box overlap above which two boxes are the same face. */
    dedupIoU: number;
    /** A box wider than this (pixels) may keep a low score. */
    largeFaceWidth: number;
}

const DEFAULTS = {
    autoAssign: 0.7,
    review: 0.9,
    acceptScore: 0.7,
    rejectFloor: 0.4,
    dedupIoU: 0.55,
    largeFaceWidth: 300,
    minSearchCutoff: 1.0,
    searchMargin: 0.1,
};

export function buildScanThresholds(
    ai: Pick<AISettings, 'autoAssignThreshold' | 'reviewThreshold'>,
    advanced: Pick<AdvancedFaceConfig, 'scoreThresholdAccept' | 'scoreThresholdReject' | 'dedupIoUThresh' | 'largeFaceThreshold' | 'strictFalsePositiveMode'>,
): ScanThresholds {
    // `||` on purpose: a distance of 0 has always meant "not set" here.
    const autoAssign = ai.autoAssignThreshold || DEFAULTS.autoAssign;
    const review = ai.reviewThreshold || DEFAULTS.review;
    return {
        autoAssign,
        review,
        searchCutoff: Math.max(review + DEFAULTS.searchMargin, DEFAULTS.minSearchCutoff),
        acceptScore: advanced.strictFalsePositiveMode ? STRICT_SCORE_THRESHOLD_ACCEPT : (advanced.scoreThresholdAccept ?? DEFAULTS.acceptScore),
        rejectFloor: advanced.scoreThresholdReject ?? DEFAULTS.rejectFloor,
        dedupIoU: advanced.dedupIoUThresh ?? DEFAULTS.dedupIoU,
        largeFaceWidth: advanced.largeFaceThreshold ?? DEFAULTS.largeFaceWidth,
    };
}
