import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyWithoutOverwrite } from '../../../../electron/lib/albumExport/copyWithoutOverwrite';

describe('copyWithoutOverwrite (real files)', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-export-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('copies the file and leaves the original in place', async () => {
        const source = path.join(dir, 'a.jpg');
        const destination = path.join(dir, 'b.jpg');
        fs.writeFileSync(source, 'photo');

        const result = await copyWithoutOverwrite(source, destination);

        expect(result).toBe('copied');
        expect(fs.readFileSync(destination, 'utf8')).toBe('photo');
        expect(fs.existsSync(source)).toBe(true);
    });

    it('reports "exists" and keeps the existing file untouched', async () => {
        const source = path.join(dir, 'a.jpg');
        const destination = path.join(dir, 'b.jpg');
        fs.writeFileSync(source, 'new');
        fs.writeFileSync(destination, 'old');

        const result = await copyWithoutOverwrite(source, destination);

        expect(result).toBe('exists');
        expect(fs.readFileSync(destination, 'utf8')).toBe('old');
    });

    it('rejects when the source is missing', async () => {
        await expect(copyWithoutOverwrite(path.join(dir, 'nope.jpg'), path.join(dir, 'out.jpg'))).rejects.toThrow();
    });
});
