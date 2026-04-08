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

const mockSendRequest = vi.fn();
vi.mock('../../../electron/infrastructure/PythonAIProvider', () => ({
    pythonProvider: { sendRequest: mockSendRequest },
}));

// ── Extract handler ───────────────────────────────────────────────────────────

function getRegisteredHandler(channel: string) {
    const entry = mockHandle.mock.calls.find(([ch]: [string]) => ch === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as (_: unknown, payload: unknown) => Promise<unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ai:compose:layers IPC handler', () => {
    let handler: (_: unknown, payload: unknown) => Promise<unknown>;

    const validLayer = {
        id: 'layer-1',
        name: 'Background',
        sourceImageB64: 'aGVsbG8=',
        maskB64: '',
        x: 0, y: 0,
        scaleX: 1, scaleY: 1,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        visible: true,
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        const { registerCompositeHandlers } = await import('../../../electron/ipc/compositeHandlers');
        registerCompositeHandlers();
        handler = getRegisteredHandler('ai:compose:layers');
    });

    it('returns error when layers array is empty', async () => {
        const res: any = await handler(null, { layers: [], width: 1920, height: 1080 });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/layers/i);
        expect(mockSendRequest).not.toHaveBeenCalled();
    });

    it('returns error when layers is missing', async () => {
        const res: any = await handler(null, { width: 1920, height: 1080 });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/layers/i);
    });

    it('forwards valid payload to Python and returns result_b64', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: true, result_b64: 'abc123' });
        const res: any = await handler(null, {
            layers: [validLayer],
            width: 1920,
            height: 1080,
        });
        expect(res.success).toBe(true);
        expect(res.result_b64).toBe('abc123');
        expect(mockSendRequest).toHaveBeenCalledWith('compose', {
            layers: [validLayer],
            width: 1920,
            height: 1080,
        });
    });

    it('returns error when Python reports failure', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: false, error: 'out of memory' });
        const res: any = await handler(null, {
            layers: [validLayer],
            width: 1920,
            height: 1080,
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('out of memory');
    });

    it('returns error when pythonProvider.sendRequest throws', async () => {
        mockSendRequest.mockRejectedValueOnce(new Error('Python crashed'));
        const res: any = await handler(null, {
            layers: [validLayer],
            width: 1920,
            height: 1080,
        });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Python crashed/i);
    });
});
