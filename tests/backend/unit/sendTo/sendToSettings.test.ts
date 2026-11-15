import { describe, it, expect } from 'vitest';
import {
    DEFAULT_CONFIRM_THRESHOLD,
    DEFAULT_MAX_COMMAND_CHARS,
    resolveSendToSettings,
} from '../../../../electron/core/services/sendTo/sendToSettings';

describe('resolveSendToSettings', () => {
    it('uses the defaults when nothing is configured', () => {
        expect(resolveSendToSettings(undefined)).toEqual({
            confirmThreshold: DEFAULT_CONFIRM_THRESHOLD,
            maxCommandChars: DEFAULT_MAX_COMMAND_CHARS,
            clearFrameExecutablePath: undefined,
        });
    });

    it('proposes confirming above 50 photos and a budget under the 32,767 character limit', () => {
        expect(DEFAULT_CONFIRM_THRESHOLD).toBe(50);
        expect(DEFAULT_MAX_COMMAND_CHARS).toBeLessThan(32767);
    });

    it('applies valid overrides per field', () => {
        const result = resolveSendToSettings({ confirmThreshold: 200, clearFrameExecutablePath: 'D:\\CF\\ClearFrame.exe' });

        expect(result.confirmThreshold).toBe(200);
        expect(result.clearFrameExecutablePath).toBe('D:\\CF\\ClearFrame.exe');
        expect(result.maxCommandChars).toBe(DEFAULT_MAX_COMMAND_CHARS);
    });

    it('allows 0 so every send asks for confirmation', () => {
        expect(resolveSendToSettings({ confirmThreshold: 0 }).confirmThreshold).toBe(0);
    });

    it.each([-1, 1.5, 'many', null, Number.NaN])('ignores an invalid threshold (%s)', bad => {
        expect(resolveSendToSettings({ confirmThreshold: bad }).confirmThreshold).toBe(DEFAULT_CONFIRM_THRESHOLD);
    });

    it('ignores a command budget that is too small or above the Windows limit', () => {
        expect(resolveSendToSettings({ maxCommandChars: 10 }).maxCommandChars).toBe(DEFAULT_MAX_COMMAND_CHARS);
        expect(resolveSendToSettings({ maxCommandChars: 40000 }).maxCommandChars).toBe(DEFAULT_MAX_COMMAND_CHARS);
    });

    it('ignores an empty or non-string executable path', () => {
        expect(resolveSendToSettings({ clearFrameExecutablePath: '  ' }).clearFrameExecutablePath).toBeUndefined();
        expect(resolveSendToSettings({ clearFrameExecutablePath: 42 }).clearFrameExecutablePath).toBeUndefined();
    });

    it('never throws on junk input', () => {
        expect(() => resolveSendToSettings('junk')).not.toThrow();
        expect(resolveSendToSettings('junk').confirmThreshold).toBe(DEFAULT_CONFIRM_THRESHOLD);
    });
});
