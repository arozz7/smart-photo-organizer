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

const ORIENTATION_BY_DESCRIPTION: Record<string, number> = {
    'Horizontal (normal)': 1,
    'Mirror horizontal': 2,
    'Rotate 180': 3,
    'Mirror vertical': 4,
    'Mirror horizontal and rotate 270 CW': 5,
    'Rotate 90 CW': 6,
    'Mirror horizontal and rotate 90 CW': 7,
    'Rotate 270 CW': 8,
};

/**
 * EXIF orientation as a number 1-8. ExifTool reports either the number or a description; a missing or
 * unrecognised value means "normal" (1), so a program that writes an explicit "Horizontal" where nothing was
 * stored is not mistaken for a rotation.
 */
export function normalizeOrientation(value: unknown): number {
    if (typeof value === 'number' && value >= 1 && value <= 8) return value;
    if (typeof value === 'string') return ORIENTATION_BY_DESCRIPTION[value] ?? 1;
    return 1;
}

/** The parts of a photo that decide where faces are: displayed size and orientation. */
export interface PhotoGeometry {
    width: number | null;
    height: number | null;
    orientation: number;
}

/**
 * True only when it can be shown that the picture geometry changed (crop, resize, rotation), which is what makes
 * old face boxes invalid. Unknown values never count as a change: re-detecting faces deletes ignored faces and era
 * assignments, so it must not happen on a guess.
 */
export function geometryChanged(before: PhotoGeometry, after: PhotoGeometry): boolean {
    if (before.width === null || before.height === null) return false;
    if (after.width === null || after.height === null) return false;
    return before.width !== after.width || before.height !== after.height || before.orientation !== after.orientation;
}
