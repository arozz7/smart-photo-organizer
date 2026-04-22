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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validImageB64 = 'aGVsbG8='; // base64 "hello" — placeholder
const validMaskB64  = 'd29ybGQ='; // base64 "world"

const globalPayload = {
    image_b64: validImageB64,
    scope: 'global',
};

const segmentPayload = {
    image_b64: validImageB64,
    scope: 'segment',
    mask_b64: validMaskB64,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ai:segment:adjust IPC handler', () => {
    let handler: (_: unknown, payload: unknown) => Promise<unknown>;

    beforeEach(async () => {
        vi.clearAllMocks();
        const { registerAdjustmentHandlers } = await import('../../../electron/ipc/adjustmentHandlers');
        registerAdjustmentHandlers();
        handler = getRegisteredHandler('ai:segment:adjust');
    });

    it('returns error when image_b64 is missing', async () => {
        const res: any = await handler(null, { scope: 'global' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/image_b64/i);
        expect(mockSendRequest).not.toHaveBeenCalled();
    });

    it('returns error when image_b64 is empty string', async () => {
        const res: any = await handler(null, { image_b64: '', scope: 'global' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/image_b64/i);
    });

    it('returns error when scope is invalid', async () => {
        const res: any = await handler(null, { image_b64: validImageB64, scope: 'invalid' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/scope/i);
        expect(mockSendRequest).not.toHaveBeenCalled();
    });

    it('returns error when scope is segment and mask_b64 is missing', async () => {
        const res: any = await handler(null, { image_b64: validImageB64, scope: 'segment' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/mask_b64/i);
        expect(mockSendRequest).not.toHaveBeenCalled();
    });

    it('returns error when scope is segment and mask_b64 is empty', async () => {
        const res: any = await handler(null, { image_b64: validImageB64, scope: 'segment', mask_b64: '' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/mask_b64/i);
    });

    it('forwards global payload to Python with correct command', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: true, result_b64: 'abc123' });
        const res: any = await handler(null, globalPayload);
        expect(res.success).toBe(true);
        expect(res.result_b64).toBe('abc123');
        expect(mockSendRequest).toHaveBeenCalledWith(
            'segment_adjust',
            expect.objectContaining({ image_b64: validImageB64, scope: 'global' }),
        );
    });

    it('forwards segment payload with mask_b64 to Python', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: true, result_b64: 'xyz789' });
        const res: any = await handler(null, segmentPayload);
        expect(res.success).toBe(true);
        expect(mockSendRequest).toHaveBeenCalledWith(
            'segment_adjust',
            expect.objectContaining({ scope: 'segment', mask_b64: validMaskB64 }),
        );
    });

    it('defaults scope to global when omitted', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: true, result_b64: 'def456' });
        const res: any = await handler(null, { image_b64: validImageB64 });
        expect(res.success).toBe(true);
        expect(mockSendRequest).toHaveBeenCalledWith(
            'segment_adjust',
            expect.objectContaining({ scope: 'global' }),
        );
    });

    it('passes params dict through to Python', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: true, result_b64: 'ghi' });
        const params = { brightness: 1.5, contrast: 0.8, shadows: 0.3 };
        await handler(null, { ...globalPayload, params });
        expect(mockSendRequest).toHaveBeenCalledWith(
            'segment_adjust',
            expect.objectContaining({ params }),
        );
    });

    it('returns Python error unchanged', async () => {
        mockSendRequest.mockResolvedValueOnce({ success: false, error: 'decode failed' });
        const res: any = await handler(null, globalPayload);
        expect(res.success).toBe(false);
        expect(res.error).toBe('decode failed');
    });

    it('returns error when sendRequest throws', async () => {
        mockSendRequest.mockRejectedValueOnce(new Error('Python crashed'));
        const res: any = await handler(null, globalPayload);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Python crashed/i);
    });
});
