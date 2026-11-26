import { describe, it, expect } from 'vitest';
import { captionsRunInScan, captionsRunInBackground } from '../../../../electron/core/services/captionTiming';

describe('captionTiming', () => {
    it('defaults to the background, so scans stay fast', () => {
        expect(captionsRunInScan({ vlmEnabled: true })).toBe(false);
        expect(captionsRunInBackground({ vlmEnabled: true })).toBe(true);
    });

    it('runs captions inside the scan only when asked to', () => {
        expect(captionsRunInScan({ vlmEnabled: true, captionTiming: 'scan' })).toBe(true);
        expect(captionsRunInBackground({ vlmEnabled: true, captionTiming: 'scan' })).toBe(false);
    });

    it('makes no captions anywhere when Smart Tags are off', () => {
        expect(captionsRunInScan({ vlmEnabled: false, captionTiming: 'scan' })).toBe(false);
        expect(captionsRunInBackground({ vlmEnabled: false, captionTiming: 'background' })).toBe(false);
    });
});
