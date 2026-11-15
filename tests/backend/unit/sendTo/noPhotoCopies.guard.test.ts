import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Decisions L-001 / L-026 / L-031: "Send to..." never copies a photo and never writes metadata.
 * The send code is therefore kept free of every file-modifying call. If a later change needs one,
 * this test forces that change to be a visible, deliberate decision.
 */
const SEND_TO_DIRECTORIES = [
    path.resolve(__dirname, '../../../../electron/core/services/sendTo'),
    path.resolve(__dirname, '../../../../electron/lib/sendTo'),
];

const FORBIDDEN_CALLS = [
    'copyFile', 'cp(', 'cpSync', 'writeFile', 'appendFile', 'createWriteStream', 'rename', 'unlink', 'rmSync', 'rm(',
    'mkdir', 'symlink', 'link(', 'exiftool', 'xmp',
];

const sourceFiles = SEND_TO_DIRECTORIES.flatMap(dir =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f)) : []);

describe('Send to... never copies or writes photos', () => {
    it('has source files to check', () => {
        expect(sourceFiles.length).toBeGreaterThan(0);
    });

    it.each(sourceFiles.map(f => [path.basename(f), f]))('%s contains no file-modifying call', (_name, file) => {
        const code = fs.readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
            .toLowerCase();

        const found = FORBIDDEN_CALLS.filter(call => code.includes(call.toLowerCase()));

        expect(found).toEqual([]);
    });
});
