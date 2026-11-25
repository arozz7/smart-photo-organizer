/**
 * Camera RAW files never reach sharp (libvips cannot decode them, and a native crash cannot be caught): the processor refuses
 * them with an ordinary error, so every caller falls back to the stored preview or the Python engine as it did when sharp failed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharpCalls = vi.hoisted(() => vi.fn());
vi.mock('sharp', () => ({ default: sharpCalls }));

import { SharpImageProcessor } from '../../../electron/services/image/ImageProcessor';

describe('SharpImageProcessor with camera RAW', () => {
    beforeEach(() => sharpCalls.mockReset());

    it.each(['D:\\p\\DSC07059.ARW', 'D:\\p\\a.cr2', 'D:\\p\\b.NEF', 'D:\\p\\c.orf', 'D:\\p\\d.rw2'])('refuses %s without calling sharp (process)', async file => {
        await expect(new SharpImageProcessor().process(file, { width: 300 })).rejects.toThrow(/Python/);

        expect(sharpCalls).not.toHaveBeenCalled();
    });

    it('refuses camera RAW without calling sharp (convertRaw)', async () => {
        await expect(new SharpImageProcessor().convertRaw('D:\\p\\DSC07059.ARW')).rejects.toThrow(/Python/);

        expect(sharpCalls).not.toHaveBeenCalled();
    });

    it('still hands a JPEG to sharp', async () => {
        const failing = { toBuffer: () => Promise.reject(new Error('reached sharp')) };
        sharpCalls.mockReturnValue({ rotate: () => ({ toFormat: () => failing }) });

        await expect(new SharpImageProcessor().convertRaw('D:\\p\\a.jpg')).rejects.toThrow('reached sharp');

        expect(sharpCalls).toHaveBeenCalledTimes(1);
    });
});
