import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrsClient, PrsApiError } from '../../../../electron/lib/prs/PrsClient';

vi.mock('../../../../electron/logger', () => ({
    default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const MOCK_TOKEN = 'test-token-abc';

describe('PrsClient', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('checkHealth', () => {
        it('returns true when health endpoint responds 200', async () => {
            fetchSpy.mockResolvedValueOnce({ ok: true } as Response);
            const client = new PrsClient(MOCK_TOKEN);
            await expect(client.checkHealth()).resolves.toBe(true);
        });

        it('returns false when health endpoint throws', async () => {
            fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            const client = new PrsClient(MOCK_TOKEN);
            await expect(client.checkHealth()).resolves.toBe(false);
        });

        it('returns false when health endpoint returns non-2xx', async () => {
            fetchSpy.mockResolvedValueOnce({ ok: false } as Response);
            const client = new PrsClient(MOCK_TOKEN);
            await expect(client.checkHealth()).resolves.toBe(false);
        });
    });

    describe('analyze', () => {
        it('POSTs to /analyze and returns jobId', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ jobId: 'job-123' }),
            } as Response);

            const client = new PrsClient(MOCK_TOKEN);
            const result = await client.analyze({ filePath: '/photos/corrupt.jpg' });

            expect(result.jobId).toBe('job-123');
            expect(fetchSpy).toHaveBeenCalledWith(
                'http://127.0.0.1:3847/api/analyze',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        Authorization: `Bearer ${MOCK_TOKEN}`,
                    }),
                }),
            );
        });
    });

    describe('getStatus', () => {
        it('GETs /status/:jobId', async () => {
            const mockStatus = { jobId: 'job-123', status: 'done', percent: 100 };
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => mockStatus,
            } as Response);

            const client = new PrsClient(MOCK_TOKEN);
            const result = await client.getStatus('job-123');

            expect(result.status).toBe('done');
            expect(fetchSpy).toHaveBeenCalledWith(
                'http://127.0.0.1:3847/api/status/job-123',
                expect.objectContaining({ method: 'GET' }),
            );
        });

        it('throws PrsApiError on non-2xx response', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => ({ error: 'not found' }),
            } as Response);

            const client = new PrsClient(MOCK_TOKEN);
            await expect(client.getStatus('missing-job')).rejects.toBeInstanceOf(PrsApiError);
        });
    });

    describe('pollUntilDone', () => {
        it('resolves immediately when first poll returns done', async () => {
            const doneStatus = {
                jobId: 'j1',
                status: 'done' as const,
                percent: 100,
                result: { outputPath: '/out.jpg' },
            };
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => doneStatus,
            } as Response);

            const client = new PrsClient(MOCK_TOKEN);
            const result = await client.pollUntilDone('j1');
            expect(result.status).toBe('done');
        });

        it('rejects when job reaches failed state on first poll', async () => {
            const failedStatus = { jobId: 'j1', status: 'failed' as const, error: 'unrecoverable' };
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => failedStatus,
            } as Response);

            const client = new PrsClient(MOCK_TOKEN);
            await expect(client.pollUntilDone('j1')).rejects.toBeInstanceOf(PrsApiError);
        });

        it('polls multiple times before reaching done state', async () => {
            vi.useFakeTimers();

            const runningStatus = { jobId: 'j1', status: 'running' as const, percent: 50 };
            const doneStatus = { jobId: 'j1', status: 'done' as const, percent: 100, result: {} };

            fetchSpy
                .mockResolvedValueOnce({ ok: true, json: async () => runningStatus } as Response)
                .mockResolvedValueOnce({ ok: true, json: async () => doneStatus } as Response);

            const client = new PrsClient(MOCK_TOKEN);
            const promise = client.pollUntilDone('j1');

            // First poll (running) happens, then sleep(2000) starts
            await vi.runAllTicks();
            await vi.advanceTimersByTimeAsync(2_100);
            // Second poll (done) happens

            const result = await promise;
            expect(result.status).toBe('done');

            vi.useRealTimers();
        });
    });
});
