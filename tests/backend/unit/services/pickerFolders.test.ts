import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { folderToRemember, startFolderFor } from '../../../../electron/core/services/pickerFolders';

describe('folderToRemember', () => {
    it('remembers the chosen folder itself for a folder picker', () => {
        expect(folderToRemember('directory', path.join('D:', 'Photos', '2024'))).toBe(path.join('D:', 'Photos', '2024'));
    });

    it('remembers the containing folder for a file picker', () => {
        expect(folderToRemember('file', path.join('C:', 'Tools', 'cf-app.exe'))).toBe(path.join('C:', 'Tools'));
    });
});

describe('startFolderFor', () => {
    const exists = (known: string[]) => (p: string) => known.includes(p);

    it('returns the saved folder for that picker when it still exists', () => {
        const saved = { directory: 'D:\\Photos', file: 'C:\\Tools' };
        expect(startFolderFor('directory', saved, exists(['D:\\Photos']))).toBe('D:\\Photos');
        expect(startFolderFor('file', saved, exists(['C:\\Tools']))).toBe('C:\\Tools');
    });

    it('returns undefined when the saved folder is gone (offline drive, deleted)', () => {
        expect(startFolderFor('directory', { directory: 'M:\\Photos' }, exists([]))).toBeUndefined();
    });

    it('keeps the two pickers separate', () => {
        expect(startFolderFor('file', { directory: 'D:\\Photos' }, exists(['D:\\Photos']))).toBeUndefined();
    });

    it.each([undefined, null, 'text', 42, [], { directory: 7 }, { directory: '' }, { directory: '   ' }])(
        'ignores an invalid saved value %j without throwing',
        (saved) => {
            expect(startFolderFor('directory', saved, () => true)).toBeUndefined();
        }
    );
});
