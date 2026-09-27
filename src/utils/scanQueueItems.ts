/** The flags the scanner puts on each photo it returns. */
export interface ScanResultPhoto {
    isNew?: boolean;
    /** The file was edited outside the app since it was indexed. */
    contentChanged?: boolean;
}

export interface ScanQueueOptions {
    forceRescan?: boolean;
}

/**
 * Which scanned photos go to the AI queue, and whether each gets a clean rescan.
 *
 *  - normal scan: new photos, plus photos edited outside the app
 *  - forced rescan: every photo
 *
 * A clean rescan replaces the photo's old faces and re-matches named people. It is used for forced rescans and for
 * edited files (their old face boxes no longer line up), never for brand new photos.
 */
export function buildScanQueueItems<T extends ScanResultPhoto>(
    results: T[],
    options: ScanQueueOptions,
): (T & { cleanRescan: boolean })[] {
    const forced = options.forceRescan === true;
    return results
        .filter(photo => forced || photo.isNew === true)
        .map(photo => ({ ...photo, cleanRescan: forced || photo.contentChanged === true }));
}
