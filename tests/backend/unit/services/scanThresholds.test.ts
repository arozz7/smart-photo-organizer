import { describe, it, expect } from 'vitest';
import { buildScanThresholds } from '../../../../electron/core/services/scanThresholds';

describe('buildScanThresholds', () => {
    it('uses the documented defaults when nothing is set', () => {
        expect(buildScanThresholds({}, {})).toEqual({
            autoAssign: 0.7, review: 0.9, searchCutoff: 1.0, acceptScore: 0.7, rejectFloor: 0.4, dedupIoU: 0.55, largeFaceWidth: 300,
        });
    });

    it('follows each setting the user can change', () => {
        const t = buildScanThresholds(
            { autoAssignThreshold: 0.5, reviewThreshold: 1.2 },
            { scoreThresholdAccept: 0.8, scoreThresholdReject: 0.3, dedupIoUThresh: 0.6, largeFaceThreshold: 250 },
        );

        expect(t).toMatchObject({ autoAssign: 0.5, review: 1.2, acceptScore: 0.8, rejectFloor: 0.3, dedupIoU: 0.6, largeFaceWidth: 250 });
    });

    it('searches a little beyond the review line, but never less than 1.0', () => {
        expect(buildScanThresholds({ reviewThreshold: 1.2 }, {}).searchCutoff).toBeCloseTo(1.3);
        expect(buildScanThresholds({ reviewThreshold: 0.6 }, {}).searchCutoff).toBe(1.0);
    });

    it('strict mode raises the accept score to the strict value whatever the accept setting says', () => {
        const t = buildScanThresholds({}, { strictFalsePositiveMode: true, scoreThresholdAccept: 0.7 });

        expect(t.acceptScore).toBe(0.75);
    });

    it('treats a zero distance setting as not set (the scan has always done this)', () => {
        const t = buildScanThresholds({ autoAssignThreshold: 0, reviewThreshold: 0 }, {});

        expect(t).toMatchObject({ autoAssign: 0.7, review: 0.9 });
    });
});
