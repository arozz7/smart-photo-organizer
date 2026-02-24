import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import path from 'node:path';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => 'C:\\tmp') },
    ipcMain: { handle: vi.fn() },
}));

vi.mock('../../../electron/logger', () => ({
    default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { mockPrsClientCheckHealth, mockPrsClientAnalyze, mockPrsClientRepair, mockPrsClientGetStatus } = vi.hoisted(() => ({
    mockPrsClientCheckHealth: vi.fn(),
    mockPrsClientAnalyze: vi.fn(),
    mockPrsClientRepair: vi.fn(),
    mockPrsClientGetStatus: vi.fn(),
}));

vi.mock('../../../electron/lib/prs/PrsClient', () => ({
    PrsClient: class MockPrsClient {
        checkHealth = mockPrsClientCheckHealth;
        analyze = mockPrsClientAnalyze;
        repair = mockPrsClientRepair;
        getStatus = mockPrsClientGetStatus;
    },
}));

const mockReadPrsToken = vi.fn();
vi.mock('../../../electron/lib/prs/PrsTokenReader', () => ({
    readPrsToken: mockReadPrsToken,
}));

const mockFindCandidates = vi.fn();
vi.mock('../../../electron/data/repositories/ReferenceRepository', () => ({
    ReferenceRepository: { findCandidates: mockFindCandidates },
}));

const mockGetPhotoById = vi.fn();
const mockMarkUnrepairable = vi.fn();
const mockDeletePhotoById = vi.fn();
const mockDeleteScanErrorAndFile = vi.fn();
vi.mock('../../../electron/data/repositories/PhotoRepository', () => ({
    PhotoRepository: {
        getPhotoById: mockGetPhotoById,
        markUnrepairable: mockMarkUnrepairable,
        deletePhotoById: mockDeletePhotoById,
        deleteScanErrorAndFile: mockDeleteScanErrorAndFile,
    },
}));

const mockEnqueueFiles = vi.fn();
vi.mock('../../../electron/scanQueue', () => ({
    scanQueue: { enqueueFiles: mockEnqueueFiles },
}));

const mockSharpMetadata = vi.fn();
vi.mock('sharp', () => ({
    default: vi.fn().mockImplementation(() => ({ metadata: mockSharpMetadata })),
}));

const mockSendRequest = vi.fn();
vi.mock('../../../electron/infrastructure/PythonAIProvider', () => ({
    pythonProvider: { sendRequest: mockSendRequest },
}));

// ── Handler registry ──────────────────────────────────────────────────────────

import { ipcMain } from 'electron';

// Capture handlers once after registration — before clearAllMocks wipes records
const handlers: Record<string, (event: any, payload: any) => Promise<any>> = {};

beforeAll(async () => {
    // Import and explicitly call registerPrsHandlers
    const { registerPrsHandlers } = await import('../../../electron/ipc/prsHandlers');
    registerPrsHandlers();

    // Cache registered channels from mock call records
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    for (const [channel, fn] of calls) {
        handlers[channel] = fn;
    }
});

function getHandler(channel: string) {
    const fn = handlers[channel];
    if (!fn) throw new Error(`No handler registered for channel: ${channel}`);
    return fn;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('prsHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadPrsToken.mockReturnValue('test-token');
    });

    describe('prs:checkAvailability', () => {
        it('returns { available: true } when PRS is healthy', async () => {
            mockPrsClientCheckHealth.mockResolvedValue(true);
            await expect(getHandler('prs:checkAvailability')({} as any, undefined))
                .resolves.toEqual({ available: true });
        });

        it('returns { available: false } when token is missing', async () => {
            mockReadPrsToken.mockReturnValue(null);
            await expect(getHandler('prs:checkAvailability')({} as any, undefined))
                .resolves.toEqual({ available: false });
        });
    });

    describe('prs:analyzeFile', () => {
        it('returns error when filePath is missing', async () => {
            const result = await getHandler('prs:analyzeFile')({} as any, { photoId: 1 });
            expect(result.error).toBeTruthy();
        });

        it('calls analyze with filePath and returns jobId', async () => {
            mockPrsClientAnalyze.mockResolvedValue({ jobId: 'job-abc' });
            const result = await getHandler('prs:analyzeFile')({} as any, { filePath: '/photos/bad.jpg' });
            expect(result.jobId).toBe('job-abc');
        });
    });

    describe('prs:submitRepair', () => {
        it('builds outputPath with _repaired suffix', async () => {
            mockFindCandidates.mockReturnValue([]);
            mockPrsClientRepair.mockResolvedValue({ jobId: 'repair-1' });

            await getHandler('prs:submitRepair')({} as any, {
                filePath: '/photos/bad.jpg',
                strategy: 'header_graft',
            });

            expect(mockPrsClientRepair).toHaveBeenCalledWith(
                expect.objectContaining({
                    outputPath: path.join('/photos', 'bad_repaired.jpg'),
                }),
            );
        });

        it('returns error when filePath is missing', async () => {
            const result = await getHandler('prs:submitRepair')({} as any, { strategy: 'header_graft' });
            expect(result.error).toBeTruthy();
        });
    });

    describe('prs:completeRepair', () => {
        it('marks unrepairable when sharp decode fails', async () => {
            mockSharpMetadata.mockRejectedValue(new Error('corrupt JPEG'));
            const result = await getHandler('prs:completeRepair')({} as any, {
                scanErrorId: 1,
                repairedFilePath: '/photos/bad_repaired.jpg',
            });
            expect(result.unrepairable).toBe(true);
            expect(mockMarkUnrepairable).toHaveBeenCalledWith(1, expect.stringContaining('Sharp decode failed'));
        });

        it('marks unrepairable when AI analysis fails', async () => {
            mockSharpMetadata.mockResolvedValue({ width: 100, height: 100 });
            mockSendRequest.mockResolvedValue({ error: 'no model loaded' });

            const result = await getHandler('prs:completeRepair')({} as any, {
                scanErrorId: 2,
                repairedFilePath: '/photos/bad_repaired.jpg',
            });
            expect(result.unrepairable).toBe(true);
            expect(mockMarkUnrepairable).toHaveBeenCalled();
        });

        it('commits repair and re-ingests file on success', async () => {
            mockSharpMetadata.mockResolvedValue({ width: 100, height: 100 });
            mockSendRequest.mockResolvedValue({ success: true });
            mockDeleteScanErrorAndFile.mockResolvedValue({ success: true });
            mockEnqueueFiles.mockResolvedValue({});

            const mockSender = {};
            const result = await getHandler('prs:completeRepair')(
                { sender: mockSender } as any,
                { scanErrorId: 3, originalPhotoId: 42, repairedFilePath: '/photos/bad_repaired.jpg' },
            );

            expect(result.success).toBe(true);
            expect(mockDeleteScanErrorAndFile).toHaveBeenCalledWith(3, false);
            expect(mockDeletePhotoById).toHaveBeenCalledWith(42);
            expect(mockEnqueueFiles).toHaveBeenCalledWith(['/photos/bad_repaired.jpg'], {}, mockSender);
        });

        it('returns error when scanErrorId is missing', async () => {
            const result = await getHandler('prs:completeRepair')({} as any, {
                repairedFilePath: '/photos/bad_repaired.jpg',
            });
            expect(result.error).toBeTruthy();
        });
    });
});
