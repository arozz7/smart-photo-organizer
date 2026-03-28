import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockHandle = vi.fn();
vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => 'C:\\tmp') },
    ipcMain: { handle: mockHandle },
}));

vi.mock('../../../electron/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockGetLibraryPath = vi.fn(() => 'C:\\Library');
vi.mock('../../../electron/core/services/ConfigService', () => ({
    ConfigService: { getLibraryPath: mockGetLibraryPath },
}));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => ({
    default: { mkdir: mockMkdir, writeFile: mockWriteFile },
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
}));

// Many other dependencies pulled in by aiHandlers — stub them out
vi.mock('../../../electron/infrastructure/PythonAIProvider', () => ({
    pythonProvider: { sendRequest: vi.fn() },
}));
vi.mock('../../../electron/core/services/PhotoService', () => ({
    PhotoService: { analyzeImage: vi.fn(), forceRescan: vi.fn() },
}));
vi.mock('../../../electron/store', () => ({
    setAISettings: vi.fn(), getAISettings: vi.fn(() => ({})),
}));
vi.mock('../../../electron/db', () => ({
    getDB: vi.fn(() => ({ prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn(), all: vi.fn() })) })),
    getDBLock: vi.fn(() => ({ release: vi.fn() })),
}));
vi.mock('../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {},
}));
vi.mock('../../../electron/core/services/FaceService', () => ({
    FaceService: {},
}));

// ── Extract handler ───────────────────────────────────────────────────────────

/** Return the handler registered for the given IPC channel. */
function getRegisteredHandler(channel: string) {
    const entry = mockHandle.mock.calls.find(([ch]: [string]) => ch === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as (_: unknown, payload: unknown) => Promise<unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('creative:saveResult IPC handler', () => {
    let handler: (_: unknown, payload: unknown) => Promise<unknown>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGetLibraryPath.mockReturnValue('C:\\Library');
        mockMkdir.mockResolvedValue(undefined);
        mockWriteFile.mockResolvedValue(undefined);

        const { registerAIHandlers } = await import('../../../electron/ipc/aiHandlers');
        registerAIHandlers();
        handler = getRegisteredHandler('creative:saveResult');
    });

    it('returns error when resultB64 is missing', async () => {
        const res: any = await handler(null, { resultB64: '', sourcePath: '/some/photo.jpg' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/resultB64/i);
    });

    it('returns error when sourcePath is missing', async () => {
        const res: any = await handler(null, { resultB64: 'abc123', sourcePath: '' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/sourcePath/i);
    });

    it('creates the dated directory and writes the PNG', async () => {
        const resultB64 = Buffer.from('fake-png-bytes').toString('base64');
        const res: any = await handler(null, { resultB64, sourcePath: '/photos/img.jpg' });

        expect(res.success).toBe(true);
        expect(typeof res.savedPath).toBe('string');
        expect(res.savedPath).toContain('Creative Results');
        expect(res.savedPath).toMatch(/creative-\d+\.png$/);

        expect(mockMkdir).toHaveBeenCalledWith(
            expect.stringContaining('Creative Results'),
            { recursive: true },
        );
        expect(mockWriteFile).toHaveBeenCalledWith(
            res.savedPath,
            Buffer.from(resultB64, 'base64'),
        );
    });

    it('returns error when fs.writeFile throws', async () => {
        mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
        const res: any = await handler(null, {
            resultB64: Buffer.from('x').toString('base64'),
            sourcePath: '/photos/img.jpg',
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('disk full');
    });

    it('uses the library path from ConfigService', async () => {
        mockGetLibraryPath.mockReturnValue('D:\\MyLibrary');
        const res: any = await handler(null, {
            resultB64: Buffer.from('x').toString('base64'),
            sourcePath: '/photos/img.jpg',
        });
        expect(res.success).toBe(true);
        expect(res.savedPath).toContain('MyLibrary');
    });
});
