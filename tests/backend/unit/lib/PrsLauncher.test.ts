import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they are available before vi.mock() factory runs
const { mockCheckHealth, mockSpawn } = vi.hoisted(() => ({
    mockCheckHealth: vi.fn(),
    mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
    spawn: mockSpawn,
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

import { ensurePrsRunning } from '../../../../electron/lib/prs/PrsLauncher';

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

    it('launches PRS with --headless and calls unref()', async () => {
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
            ['--headless'],
            expect.objectContaining({ detached: true, stdio: 'ignore' }),
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
});
