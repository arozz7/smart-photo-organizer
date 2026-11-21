import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { findStaleEngine, ENGINE_EXE } = require('../../../scripts/release/engineFreshness.cjs');

let root: string;
let engineDir: string;
let sourceDir: string;

const touch = (file: string, mtimeSeconds: number) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, mtimeSeconds, mtimeSeconds);
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-engine-'));
    engineDir = path.join(root, 'python-dist');
    sourceDir = path.join(root, 'src', 'python');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('findStaleEngine', () => {
    it('accepts an engine built after the newest Python source', () => {
        touch(path.join(sourceDir, 'main.py'), 1000);
        touch(path.join(sourceDir, 'commands', 'face_visibility.py'), 1500);
        touch(path.join(engineDir, ENGINE_EXE), 2000);

        expect(findStaleEngine(engineDir, sourceDir)).toBeNull();
    });

    it('names the newest source file when the engine is older than it (the engine would not know a new command)', () => {
        touch(path.join(sourceDir, 'main.py'), 1000);
        touch(path.join(sourceDir, 'commands', 'face_visibility.py'), 3000);
        touch(path.join(engineDir, ENGINE_EXE), 2000);

        const problem = findStaleEngine(engineDir, sourceDir);

        expect(problem).toContain('face_visibility.py');
        expect(problem).toContain('npm run build:python');
    });

    it('ignores the virtual environment, tests, caches and build folders', () => {
        touch(path.join(sourceDir, 'main.py'), 1000);
        touch(path.join(sourceDir, '.venv', 'Lib', 'site.py'), 9000);
        touch(path.join(sourceDir, '__pycache__', 'x.py'), 9000);
        touch(path.join(sourceDir, 'tests', 't.py'), 9000);
        touch(path.join(engineDir, ENGINE_EXE), 2000);

        expect(findStaleEngine(engineDir, sourceDir)).toBeNull();
    });

    it('fails when there is no engine at all', () => {
        touch(path.join(sourceDir, 'main.py'), 1000);

        expect(findStaleEngine(engineDir, sourceDir)).toContain('not found');
    });
});
