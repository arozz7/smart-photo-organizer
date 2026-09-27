/** The flags the scanner puts on each photo it returns. */
export interface ScanResultPhoto {
    isNew?: boolean;
    /** The file's bytes changed outside the app since it was indexed (informational). */
    contentChanged?: boolean;
    /** The picture geometry changed too (crop, resize, rotation): the old face boxes are invalid. */
    facesStale?: boolean;
}

export interface ScanQueueOptions {
    forceRescan?: boolean;
}

/**
 * Which scanned photos go to the AI queue, and whether each gets a clean rescan.
 *
 *  - normal scan: new photos, plus photos whose picture geometry changed outside the app (the scanner marks those new)
 *  - forced rescan: every photo
 *
 * A clean rescan deletes EVERY face on the photo (ignored ones included) and re-matches named people by embedding, so
 * it is used only when it must be: forced rescans, and photos whose geometry changed (their face boxes no longer line
 * up). Never for brand new photos, and never for a byte-only change such as keywords or a rating.
 */
export function buildScanQueueItems<T extends ScanResultPhoto>(
    results: T[],
    options: ScanQueueOptions,
): (T & { cleanRescan: boolean })[] {
    const forced = options.forceRescan === true;
    return results
        .filter(photo => forced || photo.isNew === true)
        .map(photo => ({ ...photo, cleanRescan: forced || photo.facesStale === true }));
}
