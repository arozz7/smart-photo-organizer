import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferenceRepository } from '../../../electron/data/repositories/ReferenceRepository';

vi.mock('../../../electron/db', () => ({
    getDB: vi.fn(),
}));

import { getDB } from '../../../electron/db';

const mockAll = vi.fn();
const mockPrepare = vi.fn(() => ({ all: mockAll }));

describe('ReferenceRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (getDB as ReturnType<typeof vi.fn>).mockReturnValue({ prepare: mockPrepare });
    });

    it('returns mapped candidates from the database', () => {
        mockAll.mockReturnValue([
            { file_path: '/photos/a.jpg', cameraModel: 'Canon EOS', width: 4000, height: 3000 },
            { file_path: '/photos/b.jpg', cameraModel: 'Canon EOS', width: 4000, height: 3000 },
        ]);

        const results = ReferenceRepository.findCandidates({ cameraModel: 'Canon EOS' });

        expect(results).toHaveLength(2);
        expect(results[0].filePath).toBe('/photos/a.jpg');
        expect(results[0].cameraModel).toBe('Canon EOS');
    });

    it('passes null when cameraModel is not provided', () => {
        mockAll.mockReturnValue([]);
        ReferenceRepository.findCandidates({});
        expect(mockAll).toHaveBeenCalledWith(null, null, null, null, 10);
    });

    it('passes cameraModel and resolution params correctly', () => {
        mockAll.mockReturnValue([]);
        ReferenceRepository.findCandidates({ cameraModel: 'Sony A7', resolution: '6000x4000', limit: 5 });
        expect(mockAll).toHaveBeenCalledWith('Sony A7', 'Sony A7', '6000x4000', '6000x4000', 5);
    });

    it('returns empty array when no matching candidates exist', () => {
        mockAll.mockReturnValue([]);
        const results = ReferenceRepository.findCandidates({ cameraModel: 'Unknown' });
        expect(results).toEqual([]);
    });

    it('throws when database query fails', () => {
        mockPrepare.mockImplementation(() => {
            throw new Error('DB error');
        });
        expect(() => ReferenceRepository.findCandidates({})).toThrow('ReferenceRepository.findCandidates failed');
    });
});
