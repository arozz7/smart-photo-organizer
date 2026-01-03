/**
 * Scanner Unit Tests
 * 
 * Tests the scanning logic in scanner.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// 1. Mock dependencies
const mockDBPrepare = {
    get: vi.fn(),
    run: vi.fn(),
    all: vi.fn(() => [])
};

const mockDB = {
    prepare: vi.fn(() => mockDBPrepare)
};

vi.mock('../../../electron/db', () => ({
    getDB: vi.fn(() => mockDB)
}));

vi.mock('../../../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
    }
}));

// Mock PhotoService (as used in scanner.ts via dynamic imports)
const mockExifToolInstance = {
    version: vi.fn().mockResolvedValue('12.00'),
    read: vi.fn().mockResolvedValue({ ImageWidth: 100, ImageHeight: 100 })
};

vi.mock('../../../electron/core/services/PhotoService', () => ({
    PhotoService: {
        getExifTool: vi.fn().mockResolvedValue(mockExifToolInstance),
        extractPreview: vi.fn().mockResolvedValue('/mock/previews/hash.jpg')
    }
}));

// Mock fs/promises
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        promises: {
            access: vi.fn().mockResolvedValue(undefined),
            stat: vi.fn().mockResolvedValue({ size: 1024 }),
            readdir: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
        }
    };
});

import * as scanner from '../../../electron/scanner';

describe('Scanner', () => {
    const dbState = new Map<string, any>();

    beforeEach(() => {
        vi.clearAllMocks();
        dbState.clear();

        // Stateful DB Mock
        mockDBPrepare.get.mockImplementation((filePath: string) => dbState.get(filePath));
        mockDBPrepare.run.mockImplementation((params: any) => {
            // params can be an array (for positional) or object (for named)
            // In Scanner.ts, it uses @file_path (object) for INSERT and positional for UPDATE/DELETE
            const fPath = params?.file_path || params;
            if (typeof fPath === 'string') {
                dbState.set(fPath, { id: Date.now(), file_path: fPath });
            }
            return { lastInsertRowid: 1 };
        });
    });

    describe('scanFiles', () => {
        it('should process a list of files and return photos', async () => {
            // Arrange
            const filePaths = ['/photos/a.jpg', '/photos/b.jpg'];
            const libraryPath = '/library';

            // Act
            const results = await scanner.scanFiles(filePaths, libraryPath);

            // Assert
            expect(results).toHaveLength(2);
            expect(results[0].file_path).toBe('/photos/a.jpg');
            expect(results[1].file_path).toBe('/photos/b.jpg');
        });

        it('should skip unsupported files', async () => {
            // Arrange
            const filePaths = ['/photos/a.txt', '/photos/b.jpg'];

            // Act
            const results = await scanner.scanFiles(filePaths, '/lib');

            // Assert
            expect(results).toHaveLength(1);
            expect(results[0].file_path).toBe('/photos/b.jpg');
        });

        it('should update existing photo if forceRescan is true', async () => {
            // Arrange
            const filePath = '/photos/a.jpg';
            dbState.set(filePath, { id: 1, file_path: filePath, metadata_json: '{}' });

            // Act
            const results = await scanner.scanFiles([filePath], '/lib', undefined, { forceRescan: true });

            // Assert
            expect(results).toHaveLength(1);
            expect(results[0].isNew).toBe(true);
            expect(results[0].needsUpdate).toBe(true);
        });
    });

    describe('scanDirectory', () => {
        it('should recursively scan directory', async () => {
            // Arrange
            vi.mocked(fs.readdir).mockImplementation(async (dirPath: any) => {
                if (dirPath === '/lib/photos') {
                    return [
                        { name: 'sub', isDirectory: () => true, isFile: () => false },
                        { name: 'img1.jpg', isDirectory: () => false, isFile: () => true } as any
                    ];
                }
                if (dirPath === path.join('/lib/photos', 'sub')) {
                    return [
                        { name: 'img2.png', isDirectory: () => false, isFile: () => true } as any
                    ];
                }
                return [];
            });

            // Act
            const results = await scanner.scanDirectory('/lib/photos', '/lib');

            // Assert
            expect(results).toHaveLength(2);
            const paths = results.map(r => r.file_path);
            expect(paths).toContain(path.join('/lib/photos', 'img1.jpg'));
            expect(paths).toContain(path.join('/lib/photos', 'sub', 'img2.png'));
        });
    });
});
