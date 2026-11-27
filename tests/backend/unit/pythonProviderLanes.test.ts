import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' }, BrowserWindow: class {} }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../electron/core/services/FaceService', () => ({ FaceService: {} }));
vi.mock('../../../electron/data/repositories/PhotoRepository', () => ({ PhotoRepository: {} }));
vi.mock('../../../electron/core/services/ConfigService', () => ({ ConfigService: { getSettings: vi.fn() } }));
vi.mock('../../../electron/store', () => ({ getAISettings: vi.fn(() => ({})), getLibraryPath: vi.fn() }));

import { PythonAIProvider } from '../../../electron/infrastructure/PythonAIProvider';

/** A provider talking to a fake engine: what it writes is recorded, and the test answers by hand. */
function setup() {
    const provider = new PythonAIProvider();
    const process = Object.assign(new EventEmitter(), { stdin: { write: vi.fn() }, stdout: null, stderr: null, kill: vi.fn() });
    (provider as unknown as { process: unknown }).process = process;
    (provider as unknown as { setupListeners(): void }).setupListeners();
    const written = () => process.stdin.write.mock.calls.map(([line]) => JSON.parse(line as string) as { type: string; payload: { reqId: number } });
    const types = () => written().map(command => command.type);
    const answer = async (type: string) => {
        const command = written().find(entry => entry.type === type)!;
        await (provider as unknown as { handleMessage(m: unknown): Promise<void> }).handleMessage({ type: `${type}_result`, reqId: command.payload.reqId });
    };
    return { provider, process, types, answer };
}

describe('PythonAIProvider request lanes', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('writes a request at once by default and resolves it with the engine\'s answer', async () => {
        const { provider, types, answer } = setup();

        const result = provider.sendRequest('get_system_status', {});
        expect(types()).toEqual(['get_system_status']);
        await answer('get_system_status');

        await expect(result).resolves.toMatchObject({ type: 'get_system_status_result' });
    });

    it('holds a background request while a foreground one is waiting for its answer, then writes it', async () => {
        const { provider, types, answer } = setup();
        const user = provider.sendRequest('find_ungroupable_faces', {});

        const caption = provider.sendRequest('generate_tags', {}, 60_000, { lane: 'background' });
        expect(types()).toEqual(['find_ungroupable_faces']);
        await answer('find_ungroupable_faces');
        await user;

        expect(types()).toEqual(['find_ungroupable_faces', 'generate_tags']);
        await answer('generate_tags');
        await expect(caption).resolves.toBeTruthy();
    });

    it('writes a foreground request at once even while a background request is running', () => {
        const { provider, types } = setup();
        provider.sendRequest('generate_tags', {}, 60_000, { lane: 'background' });

        provider.sendRequest('get_system_status', {});

        expect(types()).toEqual(['generate_tags', 'get_system_status']);
    });

    it('counts a background request\'s timeout from when it was written, not from when it was queued', async () => {
        const { provider, types, answer } = setup();
        const user = provider.sendRequest('find_ungroupable_faces', {}, 600_000);
        const verify = provider.sendRequest('verify_face', {}, 500, { lane: 'background' });
        let outcome = 'pending';
        verify.then(() => { outcome = 'answered'; }, reason => { outcome = String(reason); });

        await vi.advanceTimersByTimeAsync(60_000); // queued for a minute: far past its own 500 ms
        expect(outcome).toBe('pending');
        await answer('find_ungroupable_faces');
        await user;
        expect(types()).toContain('verify_face');
        await vi.advanceTimersByTimeAsync(500);

        expect(outcome).toBe('Timeout');
    });

    it('rejects a request that is still waiting in line when the engine dies', async () => {
        const { provider, process } = setup();
        provider.sendRequest('find_ungroupable_faces', {}, 600_000).catch(() => undefined);
        const queued = provider.sendRequest('generate_tags', {}, 60_000, { lane: 'background' });
        const outcome = queued.then(() => 'answered', (reason: Error) => reason.message);

        process.emit('close', 1);

        await expect(outcome).resolves.toBe('Python process exited unexpectedly');
    });
});
