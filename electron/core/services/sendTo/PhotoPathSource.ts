import { z } from 'zod';

/** What "Send to..." needs to know about one photo. */
export interface PhotoPathRow {
    id: number;
    filePath: string;
    /** Set (by library repair) when the file was last found missing; null for a healthy photo. */
    missingSince: string | null;
}

/** Turns a selection or a Smart Album into photo paths. Read-only. */
export interface PhotoPathSource {
    /** Rows for the ids that still exist in the library, in the order requested. */
    pathsForPhotoIds(ids: readonly number[]): PhotoPathRow[];
    /** Every photo of the album, or null when the album is missing or its stored filter is unreadable. */
    pathsForSmartAlbum(albumId: number): PhotoPathRow[] | null;
}

/** The columns read from the photos table. */
export interface StoredPhoto {
    id: number;
    file_path: string;
    missing_since: string | null;
}

export interface StoredSmartAlbum {
    id: number;
    name: string;
    filter_json: string;
    created_at: string;
}

export interface PhotoPage {
    photos: StoredPhoto[];
    total: number;
}

/** The existing repository calls, injected so this class stays testable without a database. */
export interface PhotoPathSourceDeps {
    getRowsByIds(ids: readonly number[]): StoredPhoto[];
    getAlbum(id: number): StoredSmartAlbum | undefined;
    /** Photos matching a flat filter (PhotoRepository.getPhotos). */
    getSimplePage(filter: unknown, offset: number, limit: number): PhotoPage;
    /** Photos matching a compound filter (PhotoRepository.getPhotosByCompoundFilter). */
    getCompoundPage(filter: unknown, offset: number, limit: number): PhotoPage;
    pageSize: number;
}

/** Same shape the Library writes when saving an album (see useSearch.createSmartAlbum). */
const storedFilterSchema = z.object({ compound: z.boolean(), filter: z.unknown() });

const toRow = (photo: StoredPhoto): PhotoPathRow => ({
    id: photo.id,
    filePath: photo.file_path,
    missingSince: photo.missing_since ?? null,
});

export class DbPhotoPathSource implements PhotoPathSource {
    constructor(private readonly deps: PhotoPathSourceDeps) {}

    pathsForPhotoIds(ids: readonly number[]): PhotoPathRow[] {
        return this.deps.getRowsByIds(ids).map(toRow);
    }

    pathsForSmartAlbum(albumId: number): PhotoPathRow[] | null {
        const album = this.deps.getAlbum(albumId);
        if (!album) return null;

        const stored = this.parseFilter(album.filter_json);
        if (!stored) return null;

        const getPage = stored.compound ? this.deps.getCompoundPage : this.deps.getSimplePage;
        const rows: PhotoPathRow[] = [];
        let offset = 0;
        let total = Number.POSITIVE_INFINITY;

        while (offset < total) {
            const page = getPage(stored.filter, offset, this.deps.pageSize);
            // An empty page ends the loop even if the total claims more, so a stale count cannot spin forever.
            if (page.photos.length === 0) break;
            rows.push(...page.photos.map(toRow));
            offset += page.photos.length;
            total = page.total;
        }
        return rows;
    }

    private parseFilter(filterJson: string): { compound: boolean; filter: unknown } | null {
        try {
            const parsed = storedFilterSchema.safeParse(JSON.parse(filterJson));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }
}
