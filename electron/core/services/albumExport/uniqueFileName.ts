import path from 'node:path';

/**
 * File name for the Nth try (0 = the original name): `photo.jpg`, `photo (2).jpg`, `photo (3).jpg`...
 * The counter goes before the extension so the file still opens with the right program.
 */
export function uniqueFileName(fileName: string, attempt: number): string {
    if (attempt === 0) return fileName;
    const extension = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - extension.length);
    return `${stem} (${attempt + 1})${extension}`;
}
