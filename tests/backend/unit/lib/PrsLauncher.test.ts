import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they are available before vi.mock() factory runs
const { mockCheckHealth, mockSpawn, mockExistsSync } = vi.hoisted(() => ({
    mockCheckHealth: vi.fn(),
    mockSpawn: vi.fn(),
    mockExistsSync: vi.fn(),
}));

vi.mock('child_process', () => ({
    spawn: mockSpawn,
}));

vi.mock('node:fs', () => ({
    existsSync: mockExistsSync,
}));

vi.mock('../../../../electron/logger', () => ({
    default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Use a class so `new PrsClient(...)` works under fake timers too
vi.mock('../../../../electron/lib/prs/PrsClient', () => ({
    PrsClient: class MockPrsClient {
        checkHealth = mockCheckHealth;
    },
}));

import { ensurePrsRunning, probeNsisDefaultPath } from '../../../../electron/lib/prs/PrsLauncher';

/** Returns a minimal detached child stub with an unref() spy */
function makeChildStub() {
    return { unref: vi.fn() };
}

describe('PrsLauncher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns { ok: true } immediately when PRS is already healthy', async () => {
        mockCheckHealth.mockResolvedValue(true);

        const result = await ensurePrsRunning();
        expect(result.ok).toBe(true);
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns { ok: false, reason: not_configured } when PRS is down and no path given', async () => {
        mockCheckHealth.mockResolvedValue(false);

        const result = await ensurePrsRunning(undefined);
        expect(result.ok).toBe(false);
        expect((result as any).reason).toBe('not_configured');
    });

    it('returns { ok: false, reason: launch_failed } when spawn throws', async () => {
        mockCheckHealth.mockResolvedValue(false);
        mockSpawn.mockImplementation(() => { throw new Error('ENOENT'); });

        const result = await ensurePrsRunning('/path/to/prs.exe');
        expect(result.ok).toBe(false);
        expect((result as any).reason).toBe('launch_failed');
    });

    it('spawns with HEADLESS=true env var, no --headless arg, and calls unref()', async () => {
        vi.useFakeTimers();

        const child = makeChildStub();
        mockSpawn.mockReturnValue(child);
        mockCheckHealth
            .mockResolvedValueOnce(false)  // pre-launch check
            .mockResolvedValue(true);      // first poll — healthy

        const promise = ensurePrsRunning('/path/to/prs.exe');
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        expect(mockSpawn).toHaveBeenCalledWith(
            '/path/to/prs.exe',
            [],  // --headless flag must NOT be passed (not forwarded by portable wrapper)
            expect.objectContaining({
                env: expect.objectContaining({ HEADLESS: 'true' }),
                detached: true,
                stdio: 'ignore',
            }),
        );
        expect(child.unref).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('returns { ok: true } when PRS becomes healthy after launch', async () => {
        vi.useFakeTimers();

        const child = makeChildStub();
        mockSpawn.mockReturnValue(child);
        mockCheckHealth
            .mockResolvedValueOnce(false)  // pre-launch check
            .mockResolvedValueOnce(false)  // first poll (500ms)
            .mockResolvedValue(true);      // second poll — healthy

        const promise = ensurePrsRunning('/path/to/prs.exe');

        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);

        const result = await promise;
        expect(result.ok).toBe(true);

        vi.useRealTimers();
    });

    it('returns { ok: false, reason: timeout } when PRS never becomes healthy', async () => {
        vi.useFakeTimers();

        const child = makeChildStub();
        mockSpawn.mockReturnValue(child);
        mockCheckHealth.mockResolvedValue(false);

        const promise = ensurePrsRunning('/path/to/prs.exe');

        await vi.advanceTimersByTimeAsync(21_000);

        const result = await promise;
        expect(result.ok).toBe(false);
        expect((result as any).reason).toBe('timeout');

        vi.useRealTimers();
    });

    it('returns { ok: false, reason: not_configured } when no path given and NSIS probe finds nothing', async () => {
        mockCheckHealth.mockResolvedValue(false);
        mockExistsSync.mockReturnValue(false);

        const result = await ensurePrsRunning(undefined);
        expect(result.ok).toBe(false);
        expect((result as any).reason).toBe('not_configured');
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('uses NSIS probe path when no executablePath is given and probe finds the exe', async () => {
        vi.useFakeTimers();

        mockExistsSync.mockReturnValue(true);
        const child = makeChildStub();
        mockSpawn.mockReturnValue(child);
        mockCheckHealth
            .mockResolvedValueOnce(false)  // pre-launch check
            .mockResolvedValue(true);      // first poll — healthy

        const promise = ensurePrsRunning(undefined);
        await vi.advanceTimersByTimeAsync(600);
        const result = await promise;

        expect(result.ok).toBe(true);
        expect(mockSpawn).toHaveBeenCalledWith(
            expect.stringContaining('Photo Repair Shop.exe'),
            [],
            expect.objectContaining({ env: expect.objectContaining({ HEADLESS: 'true' }) }),
        );

        vi.useRealTimers();
    });
});

describe('probeNsisDefaultPath', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when the NSIS default path does not exist', () => {
        mockExistsSync.mockReturnValue(false);

        const result = probeNsisDefaultPath();
        expect(result).toBeNull();
    });

    it('returns the path when the NSIS default path exists', () => {
        mockExistsSync.mockReturnValue(true);

        const result = probeNsisDefaultPath();
        expect(result).toContain('Photo Repair Shop.exe');
        expect(result).toContain('Photo Repair Shop');
    });
});
