import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClusterCacheFileStore } from '../../../electron/infrastructure/ClusterCacheFileStore';

const entry = { optionsKey: 'v1|x', faceIds: [1, 2, 3], clusters: [[1, 2]], singles: [3] };

describe('ClusterCacheFileStore', () => {
    let dir: string;
    let file: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-cluster-cache-')); file = path.join(dir, 'cluster-cache.json'); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('has nothing when no file exists yet', () => {
        expect(new ClusterCacheFileStore(file).load()).toBeNull();
    });

    it('gives back what was saved, from a new store (after a restart)', () => {
        new ClusterCacheFileStore(file).save(entry);

        expect(new ClusterCacheFileStore(file).load()).toEqual(entry);
    });

    it('creates the folder when it is missing', () => {
        const nested = path.join(dir, 'a', 'b', 'cluster-cache.json');

        new ClusterCacheFileStore(nested).save(entry);

        expect(new ClusterCacheFileStore(nested).load()).toEqual(entry);
    });

    it('treats a damaged file as empty', () => {
        fs.writeFileSync(file, '{"optionsKey": "v1|x", "faceIds": [1,');

        expect(new ClusterCacheFileStore(file).load()).toBeNull();
    });

    it('treats a file of the wrong shape as empty', () => {
        fs.writeFileSync(file, JSON.stringify({ optionsKey: 'v1|x', faceIds: 'no', clusters: [], singles: [] }));

        expect(new ClusterCacheFileStore(file).load()).toBeNull();
    });

    it('replaces the file whole and leaves no temporary file behind', () => {
        const store = new ClusterCacheFileStore(file);
        store.save(entry);
        store.save({ ...entry, singles: [] });

        expect(store.load()).toEqual({ ...entry, singles: [] });
        expect(fs.readdirSync(dir)).toEqual(['cluster-cache.json']);
    });

    it('does not throw when the file cannot be written (the cache is only a speed-up)', () => {
        const blocked = path.join(dir, 'blocked');
        fs.writeFileSync(blocked, 'a file where a folder is needed');

        expect(() => new ClusterCacheFileStore(path.join(blocked, 'cluster-cache.json')).save(entry)).not.toThrow();
    });
});
