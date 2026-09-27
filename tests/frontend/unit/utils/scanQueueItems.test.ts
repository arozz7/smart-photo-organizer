import { describe, it, expect } from 'vitest';
import { buildScanQueueItems } from '../../../../src/utils/scanQueueItems';

const photo = (id: number, flags: { isNew?: boolean; contentChanged?: boolean; facesStale?: boolean } = {}) => ({ id, ...flags });

describe('buildScanQueueItems', () => {
    it('queues only new photos on a normal scan, without a clean rescan', () => {
        // Arrange
        const results = [photo(1, { isNew: true }), photo(2, { isNew: false })];

        // Act
        const items = buildScanQueueItems(results, {});

        // Assert
        expect(items).toEqual([{ id: 1, isNew: true, cleanRescan: false }]);
    });

    it('queues a photo whose picture geometry changed outside the app with a CLEAN rescan (old face boxes are invalid)', () => {
        // Arrange
        const results = [photo(1, { isNew: true, contentChanged: true, facesStale: true })];

        // Act
        const [item] = buildScanQueueItems(results, {});

        // Assert
        expect(item.cleanRescan).toBe(true);
    });

    it('never gives a clean rescan to a photo that only had its bytes changed (a clean rescan deletes ignored faces and eras)', () => {
        // Arrange — e.g. keywords written into the file: the scanner does not even mark it new
        const results = [photo(1, { isNew: false, contentChanged: true, facesStale: false })];

        // Act / Assert
        expect(buildScanQueueItems(results, {})).toEqual([]);
        expect(buildScanQueueItems([photo(1, { isNew: true, contentChanged: true, facesStale: false })], {})[0].cleanRescan).toBe(false);
    });

    it('does not clean-rescan a brand new photo (there are no old faces to replace)', () => {
        expect(buildScanQueueItems([photo(1, { isNew: true, facesStale: false })], {})[0].cleanRescan).toBe(false);
    });

    it('a forced rescan queues every photo, all with a clean rescan', () => {
        // Arrange
        const results = [photo(1, { isNew: true }), photo(2, { isNew: false }), photo(3)];

        // Act
        const items = buildScanQueueItems(results, { forceRescan: true });

        // Assert
        expect(items.map(i => i.id)).toEqual([1, 2, 3]);
        expect(items.every(i => i.cleanRescan)).toBe(true);
    });

    it('returns nothing when nothing is new or stale', () => {
        expect(buildScanQueueItems([photo(1), photo(2, { isNew: false })], {})).toEqual([]);
    });

    it('keeps every other field of the photo', () => {
        const [item] = buildScanQueueItems([{ id: 9, isNew: true, file_path: 'a.jpg' }], {});

        expect(item).toMatchObject({ id: 9, file_path: 'a.jpg' });
    });
});
