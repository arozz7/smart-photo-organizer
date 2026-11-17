/**
 * Real exiftool-vendored: the scanner's tag parsing (capture date, orientation, dimensions) must keep working
 * across exiftool-vendored upgrades. The other tests mock ExifTool, so only this one notices a changed tag shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ExifTool } from 'exiftool-vendored';

import { parseExifDate } from '../../../electron/utils/exifDate';
import { extractDimensions, normalizeOrientation, resolveDateTaken } from '../../../electron/scanning/imageMetadata';

describe('exiftool-vendored tag shapes the scanner depends on', () => {
    let dir: string;
    let exiftool: ExifTool;
    let photo: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-exif-'));
        photo = path.join(dir, 'tagged.jpg');
        await sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } }).jpeg().toFile(photo);

        exiftool = new ExifTool({ taskTimeoutMillis: 20000 });
        // Orientation is written by description; a bare number is not convertible without the "#" suffix.
        const result = await exiftool.write(
            photo,
            { DateTimeOriginal: '2020:05:17 14:30:00', Orientation: 'Rotate 90 CW' },
            ['-overwrite_original'],
        );
        expect(result.warnings ?? []).toEqual([]);
    }, 30000);

    afterAll(async () => {
        await exiftool.end();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads the capture date in a form parseExifDate turns into the stored local time', async () => {
        const tags = await exiftool.read(photo);

        expect(parseExifDate(tags.DateTimeOriginal)).toBe('2020-05-17T14:30:00');
        expect(resolveDateTaken(tags as Record<string, unknown>, {
            birthtime: () => new Date(0),
            now: () => new Date(0),
        })).toBe('2020-05-17T14:30:00');
    }, 30000);

    it('reads the orientation so it normalises to 6 and swaps the displayed size', async () => {
        const tags = await exiftool.read(photo);

        expect(normalizeOrientation(tags.Orientation)).toBe(6);
        expect(extractDimensions(tags as Record<string, unknown>)).toEqual({ width: 20, height: 40 });
    }, 30000);
});
