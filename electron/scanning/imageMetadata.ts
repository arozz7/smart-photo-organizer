import { parseExifDate } from '../utils/exifDate';

/** ExifTool tags (only the few keys the scanner reads are accessed by name). */
export type ExifTags = Record<string, unknown>;

/** EXIF orientations that turn the image sideways, so stored dimensions must be swapped. */
const SIDEWAYS_ORIENTATIONS: readonly unknown[] = [6, 8, 5, 7, 'Rotate 90 CW', 'Rotate 270 CW'];

const firstNumber = (...candidates: unknown[]): number | null => {
    const found = candidates.find(Boolean);
    return found ? (found as number) : null;
};

/** Pixel dimensions as displayed, i.e. width/height swapped for sideways orientations. */
export function extractDimensions(tags: ExifTags): { width: number | null; height: number | null } {
    const width = firstNumber(tags.ImageWidth, tags.SourceImageWidth, tags.ExifImageWidth);
    const height = firstNumber(tags.ImageHeight, tags.SourceImageHeight, tags.ExifImageHeight);

    if (SIDEWAYS_ORIENTATIONS.includes(tags.Orientation) && width && height) {
        return { width: height, height: width };
    }
    return { width, height };
}

export interface DateFallbacks {
    birthtime(): Date;
    now(): Date;
}

/** Capture date: EXIF first, then the file's birthtime, then the current time. */
export function resolveDateTaken(tags: ExifTags, fallbacks: DateFallbacks): string {
    const fromExif = parseExifDate(tags.DateTimeOriginal || tags.CreateDate || tags.MediaCreateDate);
    if (fromExif) return fromExif;

    try {
        return fallbacks.birthtime().toISOString();
    } catch {
        return fallbacks.now().toISOString();
    }
}
