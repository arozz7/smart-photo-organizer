/**
 * Parse EXIF date string to ISO 8601.
 * EXIF format: "YYYY:MM:DD HH:MM:SS" or ExifDateTime objects with rawValue.
 * Returns ISO string or null if unparseable.
 */
export function parseExifDate(exifDate: any): string | null {
    if (!exifDate) return null;

    // ExifDateTime objects from exiftool-vendored have a rawValue or toString
    const raw: string = typeof exifDate === 'string'
        ? exifDate
        : exifDate.rawValue || exifDate.toString?.() || String(exifDate);

    if (!raw || raw === 'undefined' || raw === 'null') return null;

    // EXIF format: "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
    const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (match) {
        const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}`;
        if (!isNaN(Date.parse(iso))) return iso;
    }

    // Already ISO format or other parseable format
    const parsed = Date.parse(raw);
    if (!isNaN(parsed)) return new Date(parsed).toISOString();

    return null;
}
