import { describe, it, expect } from 'vitest';
import { parseSendRequest, parseSendToSettingsUpdate, MAX_SELECTION_IDS } from '../../../../electron/core/services/sendTo/sendRequestSchema';

describe('parseSendRequest', () => {
    it('accepts a selection of photo ids', () => {
        expect(parseSendRequest({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 2] } }))
            .toEqual({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 2] } });
    });

    it('accepts a Smart Album and the confirmed flag', () => {
        expect(parseSendRequest({ targetId: 'clearframe', source: { kind: 'smartAlbum', albumId: 3 }, confirmed: true }))
            .toEqual({ targetId: 'clearframe', source: { kind: 'smartAlbum', albumId: 3 }, confirmed: true });
    });

    it.each([
        ['not an object', 'hello'],
        ['no target', { source: { kind: 'photos', ids: [1] } }],
        ['an empty target', { targetId: '', source: { kind: 'photos', ids: [1] } }],
        ['an unknown source kind', { targetId: 'clearframe', source: { kind: 'folder', path: 'C:\\' } }],
        ['file paths instead of ids', { targetId: 'clearframe', source: { kind: 'photos', ids: ['C:\\a.jpg'] } }],
        ['a fractional id', { targetId: 'clearframe', source: { kind: 'photos', ids: [1.5] } }],
        ['a negative id', { targetId: 'clearframe', source: { kind: 'photos', ids: [-1] } }],
        ['no ids', { targetId: 'clearframe', source: { kind: 'photos', ids: [] } }],
        ['a bad album id', { targetId: 'clearframe', source: { kind: 'smartAlbum', albumId: 'x' } }],
        ['a non-boolean confirmed', { targetId: 'clearframe', source: { kind: 'photos', ids: [1] }, confirmed: 'yes' }],
    ])('rejects %s', (_label, payload) => {
        expect(parseSendRequest(payload)).toBeNull();
    });

    it('rejects an absurdly large selection', () => {
        const ids = Array.from({ length: MAX_SELECTION_IDS + 1 }, (_, i) => i + 1);

        expect(parseSendRequest({ targetId: 'clearframe', source: { kind: 'photos', ids } })).toBeNull();
    });

    it('drops unexpected extra fields (an executable path from the UI is never honoured)', () => {
        const parsed = parseSendRequest({
            targetId: 'clearframe',
            source: { kind: 'photos', ids: [1] },
            executablePath: 'C:\\evil.exe',
        });

        expect(parsed).toEqual({ targetId: 'clearframe', source: { kind: 'photos', ids: [1] } });
    });
});

describe('parseSendToSettingsUpdate', () => {
    it('accepts the settings the user can change', () => {
        expect(parseSendToSettingsUpdate({ confirmThreshold: 120, clearFrameExecutablePath: 'D:\\CF\\cf-app.exe' }))
            .toEqual({ confirmThreshold: 120, clearFrameExecutablePath: 'D:\\CF\\cf-app.exe' });
    });

    it('accepts an empty path, which means "use the default location"', () => {
        expect(parseSendToSettingsUpdate({ clearFrameExecutablePath: '' })).toEqual({ clearFrameExecutablePath: '' });
    });

    it.each([
        ['a negative threshold', { confirmThreshold: -1 }],
        ['a text threshold', { confirmThreshold: 'many' }],
        ['not an object', 7],
    ])('rejects %s', (_label, payload) => {
        expect(parseSendToSettingsUpdate(payload)).toBeNull();
    });

    it('does not let the UI change the command-line budget', () => {
        expect(parseSendToSettingsUpdate({ maxCommandChars: 5000 })).toEqual({});
    });
});
