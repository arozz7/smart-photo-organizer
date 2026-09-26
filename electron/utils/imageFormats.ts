/**
 * Single source of truth for which image files the app scans and how they are handled.
 *
 * "Standard" images can be decoded directly (sharp / PIL). Anything else that is supported
 * (camera RAW formats, TIFF) takes the RAW-like path.
 */

/** Directly decodable formats. */
const STANDARD_IMAGE_EXTENSIONS: readonly string[] = ['.jpg', '.jpeg', '.png', '.jfif', '.webp'];

/** Formats that need the RAW-like path (embedded previews, RAW decoding). */
const RAW_LIKE_EXTENSIONS: readonly string[] = ['.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];

export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = [...STANDARD_IMAGE_EXTENSIONS, ...RAW_LIKE_EXTENSIONS];

const normalise = (ext: string): string => ext.toLowerCase();

export function isSupportedImageExtension(ext: string): boolean {
    return SUPPORTED_IMAGE_EXTENSIONS.includes(normalise(ext));
}

export function isStandardImageExtension(ext: string): boolean {
    return STANDARD_IMAGE_EXTENSIONS.includes(normalise(ext));
}

/** True for supported formats that are not directly decodable. */
export function isRawLikeExtension(ext: string): boolean {
    return RAW_LIKE_EXTENSIONS.includes(normalise(ext));
}
