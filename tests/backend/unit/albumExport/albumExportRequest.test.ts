import { describe, it, expect } from 'vitest';
import { parseAlbumExportRequest } from '../../../../electron/core/services/albumExport/albumExportRequest';

describe('parseAlbumExportRequest', () => {
    it('accepts photo ids and a target folder', () => {
        expect(parseAlbumExportRequest({ photoIds: [1, 2], targetDir: 'E:\\Export' })).toEqual({ photoIds: [1, 2], targetDir: 'E:\\Export' });
    });

    it.each([
        ['not an object', 'x'],
        ['no ids', { photoIds: [], targetDir: 'E:\\Export' }],
        ['text ids', { photoIds: ['a.jpg'], targetDir: 'E:\\Export' }],
        ['a fractional id', { photoIds: [1.5], targetDir: 'E:\\Export' }],
        ['no folder', { photoIds: [1] }],
        ['an empty folder', { photoIds: [1], targetDir: '' }],
        ['a relative folder', { photoIds: [1], targetDir: 'Export' }],
    ])('rejects %s', (_label, payload) => {
        expect(parseAlbumExportRequest(payload)).toBeNull();
    });
});
