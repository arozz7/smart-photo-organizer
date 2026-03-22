import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhotoRepository } from '../../../electron/data/repositories/PhotoRepository';

vi.mock('../../../electron/db', () => ({
    getDB: vi.fn(),
}));

import { getDB } from '../../../electron/db';

// Helpers to build a chainable mock
function makeStmt(result: any) {
    return { all: vi.fn(() => result), get: vi.fn(() => result) };
}

describe('PhotoRepository.getBlurryPhotos', () => {
    const mockPrepare = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (getDB as ReturnType<typeof vi.fn>).mockReturnValue({
            prepare: mockPrepare,
            function: vi.fn(), // ensureFunctions
        });
    });

    it('returns photos and total for groupBy=none', () => {
        const fakePhotos = [
            { id: 1, file_path: '/photos/a.jpg', blur_score: 10, date_taken: '2023-01-01', metadata_json: null, folder: '/photos' },
            { id: 2, file_path: '/photos/b.jpg', blur_score: 5,  date_taken: '2023-02-01', metadata_json: null, folder: '/photos' },
        ];

        mockPrepare
            .mockReturnValueOnce(makeStmt(fakePhotos))   // SELECT rows
            .mockReturnValueOnce(makeStmt({ total: 2 })); // COUNT

        const result = PhotoRepository.getBlurryPhotos({ threshold: 50, groupBy: 'none' });

        expect(result.photos).toHaveLength(2);
        expect(result.total).toBe(2);
        expect(result.photos[0].blur_score).toBe(10);
    });

    it('uses ORDER BY folder for groupBy=folder', () => {
        mockPrepare
            .mockReturnValueOnce(makeStmt([]))
            .mockReturnValueOnce(makeStmt({ total: 0 }));

        PhotoRepository.getBlurryPhotos({ threshold: 30, groupBy: 'folder' });

        const sql: string = mockPrepare.mock.calls[0][0];
        expect(sql).toContain('DIRNAME(file_path) ASC');
    });

    it('uses GPS ORDER BY for groupBy=location', () => {
        mockPrepare
            .mockReturnValueOnce(makeStmt([]))
            .mockReturnValueOnce(makeStmt({ total: 0 }));

        PhotoRepository.getBlurryPhotos({ threshold: 30, groupBy: 'location' });

        const sql: string = mockPrepare.mock.calls[0][0];
        expect(sql).toContain('GPSLatitude');
    });

    it('passes threshold as WHERE parameter', () => {
        const stmt = makeStmt([]);
        const countStmt = makeStmt({ total: 0 });
        mockPrepare
            .mockReturnValueOnce(stmt)
            .mockReturnValueOnce(countStmt);

        PhotoRepository.getBlurryPhotos({ threshold: 42, groupBy: 'none' });

        // First call: rows query — first param is threshold
        expect(stmt.all).toHaveBeenCalledWith(42, 100, 0);
        // Second call: count query — first param is threshold
        expect(countStmt.get).toHaveBeenCalledWith(42);
    });

    it('respects custom limit and offset', () => {
        const stmt = makeStmt([]);
        const countStmt = makeStmt({ total: 0 });
        mockPrepare
            .mockReturnValueOnce(stmt)
            .mockReturnValueOnce(countStmt);

        PhotoRepository.getBlurryPhotos({ threshold: 20, groupBy: 'none', limit: 10, offset: 50 });

        expect(stmt.all).toHaveBeenCalledWith(20, 10, 50);
    });

    it('throws a descriptive error when the DB query fails', () => {
        mockPrepare.mockImplementation(() => {
            throw new Error('disk I/O error');
        });

        expect(() =>
            PhotoRepository.getBlurryPhotos({ threshold: 20, groupBy: 'none' })
        ).toThrow('PhotoRepository.getBlurryPhotos failed');
    });

    it('returns empty results when no photos are below threshold', () => {
        mockPrepare
            .mockReturnValueOnce(makeStmt([]))
            .mockReturnValueOnce(makeStmt({ total: 0 }));

        const result = PhotoRepository.getBlurryPhotos({ threshold: 1, groupBy: 'none' });

        expect(result.photos).toEqual([]);
        expect(result.total).toBe(0);
    });
});
