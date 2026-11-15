import { describe, it, expect } from 'vitest';
import { uniqueFileName } from '../../../../electron/core/services/albumExport/uniqueFileName';

describe('uniqueFileName', () => {
    it('keeps the name when it is free', () => {
        expect(uniqueFileName('IMG_0001.jpg', 0)).toBe('IMG_0001.jpg');
    });

    it('adds a counter before the extension', () => {
        expect(uniqueFileName('IMG_0001.jpg', 1)).toBe('IMG_0001 (2).jpg');
        expect(uniqueFileName('IMG_0001.jpg', 2)).toBe('IMG_0001 (3).jpg');
    });

    it('works for names with several dots', () => {
        expect(uniqueFileName('holiday.2024.final.png', 1)).toBe('holiday.2024.final (2).png');
    });

    it('works for names without an extension', () => {
        expect(uniqueFileName('README', 1)).toBe('README (2)');
    });

    it('treats a leading dot as part of the name, not an extension', () => {
        expect(uniqueFileName('.hidden', 1)).toBe('.hidden (2)');
    });
});
