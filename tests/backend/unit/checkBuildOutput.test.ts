import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { findBuildProblems } = require('../../../scripts/dev/check-build-output.cjs');

let dir: string;
const write = (name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-dist-electron-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('findBuildProblems', () => {
    it('accepts a build where native modules are imported, not bundled', () => {
        write('main.js', 'import a from "./db-1.js";\nimport s from "sharp";\nimport { ExifTool } from "exiftool-vendored";');
        write('db-1.js', 'import Database from "better-sqlite3";\nexport { Database };');

        expect(findBuildProblems(dir)).toEqual([]);
    });

    it('reports a native module whose source was bundled into a chunk main.js loads', () => {
        write('main.js', 'import "./db-1.js";\nimport s from "sharp";\nimport "exiftool-vendored";');
        write('db-1.js', '// node_modules/better-sqlite3/lib/util.js\nvar x = 1;');

        const problems = findBuildProblems(dir);

        expect(problems.join('\n')).toMatch(/better-sqlite3/);
        expect(problems.join('\n')).toMatch(/db-1\.js/);
    });

    it('ignores stale chunks from older builds that main.js no longer loads', () => {
        write('main.js', 'import "./db-2.js";\nimport s from "sharp";\nimport "exiftool-vendored";');
        write('db-2.js', 'import D from "better-sqlite3";');
        write('db-old.js', '// node_modules/better-sqlite3/lib/util.js');

        expect(findBuildProblems(dir)).toEqual([]);
    });

    it('reports a native module that is never imported at all', () => {
        write('main.js', 'import s from "sharp";\nimport "exiftool-vendored";');

        expect(findBuildProblems(dir).join('\n')).toMatch(/better-sqlite3/);
    });

    it('reports a missing main.js', () => {
        expect(findBuildProblems(dir).join('\n')).toMatch(/main\.js/);
    });
});
