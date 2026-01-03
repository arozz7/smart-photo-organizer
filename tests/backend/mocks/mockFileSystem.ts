/**
 * Mock File System Utility
 * 
 * Provides mocked file system operations for testing
 * without touching the real filesystem.
 */

import { vi } from 'vitest';
import type { Stats } from 'node:fs';

/**
 * In-memory file system storage
 */
const virtualFS: Map<string, VirtualFile> = new Map();

interface VirtualFile {
    content: Buffer | string;
    stats: Partial<Stats>;
    isDirectory: boolean;
}

/**
 * Creates a mock file in the virtual file system
 */
export function addVirtualFile(
    path: string,
    content: Buffer | string = '',
    stats: Partial<Stats> = {}
): void {
    virtualFS.set(normalizePath(path), {
        content,
        stats: {
            size: typeof content === 'string' ? content.length : content.length,
            isFile: () => true,
            isDirectory: () => false,
            mtime: new Date(),
            ...stats
        },
        isDirectory: false
    });
}

/**
 * Creates a mock directory in the virtual file system
 */
export function addVirtualDirectory(path: string): void {
    virtualFS.set(normalizePath(path), {
        content: '',
        stats: {
            isFile: () => false,
            isDirectory: () => true,
            mtime: new Date()
        },
        isDirectory: true
    });
}

/**
 * Clears the virtual file system
 */
export function clearVirtualFS(): void {
    virtualFS.clear();
}

/**
 * Gets virtual file content
 */
export function getVirtualFile(path: string): VirtualFile | undefined {
    return virtualFS.get(normalizePath(path));
}

/**
 * List files in virtual directory
 */
export function listVirtualDirectory(dirPath: string): string[] {
    const normalizedDir = normalizePath(dirPath);
    const files: string[] = [];

    for (const [path] of virtualFS) {
        if (path.startsWith(normalizedDir) && path !== normalizedDir) {
            const relativePath = path.slice(normalizedDir.length + 1);
            const firstSegment = relativePath.split('/')[0];
            if (firstSegment && !files.includes(firstSegment)) {
                files.push(firstSegment);
            }
        }
    }

    return files;
}

/**
 * Normalize path for cross-platform consistency
 */
function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Creates a mock for Node's fs module
 */
export function createFsMock() {
    return {
        existsSync: vi.fn((path: string) => virtualFS.has(normalizePath(path))),

        readFileSync: vi.fn((path: string) => {
            const file = virtualFS.get(normalizePath(path));
            if (!file) throw new Error(`ENOENT: no such file: ${path}`);
            return file.content;
        }),

        writeFileSync: vi.fn((path: string, content: Buffer | string) => {
            addVirtualFile(path, content);
        }),

        statSync: vi.fn((path: string) => {
            const file = virtualFS.get(normalizePath(path));
            if (!file) throw new Error(`ENOENT: no such file: ${path}`);
            return file.stats;
        }),

        readdirSync: vi.fn((dirPath: string) => {
            return listVirtualDirectory(dirPath);
        }),

        mkdirSync: vi.fn((path: string) => {
            addVirtualDirectory(path);
        }),

        unlinkSync: vi.fn((path: string) => {
            virtualFS.delete(normalizePath(path));
        }),

        copyFileSync: vi.fn((src: string, dest: string) => {
            const file = virtualFS.get(normalizePath(src));
            if (!file) throw new Error(`ENOENT: no such file: ${src}`);
            virtualFS.set(normalizePath(dest), { ...file });
        }),

        promises: {
            readFile: vi.fn(async (path: string) => {
                const file = virtualFS.get(normalizePath(path));
                if (!file) throw new Error(`ENOENT: no such file: ${path}`);
                return file.content;
            }),

            writeFile: vi.fn(async (path: string, content: Buffer | string) => {
                addVirtualFile(path, content);
            }),

            stat: vi.fn(async (path: string) => {
                const file = virtualFS.get(normalizePath(path));
                if (!file) throw new Error(`ENOENT: no such file: ${path}`);
                return file.stats;
            }),

            readdir: vi.fn(async (dirPath: string) => {
                return listVirtualDirectory(dirPath);
            }),

            mkdir: vi.fn(async (path: string) => {
                addVirtualDirectory(path);
            }),

            unlink: vi.fn(async (path: string) => {
                virtualFS.delete(normalizePath(path));
            })
        }
    };
}

/**
 * Creates a mock for Node's path module
 * (Usually not needed to mock, but available if required)
 */
export function createPathMock() {
    return {
        join: vi.fn((...paths: string[]) => paths.join('/')),
        resolve: vi.fn((...paths: string[]) => paths.join('/')),
        dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
        basename: vi.fn((p: string) => p.split('/').pop() || ''),
        extname: vi.fn((p: string) => {
            const match = p.match(/\.[^.]+$/);
            return match ? match[0] : '';
        })
    };
}
