import { describe, it, expect, vi } from 'vitest';
import { ClearFrameTarget, CLEARFRAME_TARGET_ID } from '../../../../electron/core/services/sendTo/ClearFrameTarget';
import { quotedLength } from '../../../../electron/core/services/sendTo/PathBatcher';
import { DEFAULT_MAX_COMMAND_CHARS, type SendToSettings } from '../../../../electron/core/services/sendTo/sendToSettings';

const EXE = 'C:\\Users\\me\\AppData\\Local\\ClearFrame\\cf-app.exe';

const settings = (overrides: Partial<SendToSettings> = {}): SendToSettings => ({
    confirmThreshold: 50,
    maxCommandChars: DEFAULT_MAX_COMMAND_CHARS,
    clearFrameExecutablePath: EXE,
    ...overrides,
});

const makeTarget = (
    launch = vi.fn(async () => undefined),
    probeInstalledPath: () => string | null = () => null,
    waitUntilReady: () => Promise<boolean> = async () => true,
) => {
    const wait = vi.fn(waitUntilReady);
    return { launch, wait, target: new ClearFrameTarget({ launch, probeInstalledPath, waitUntilReady: wait }) };
};

describe('ClearFrameTarget', () => {
    it('identifies itself for the registry', () => {
        const { target } = makeTarget();

        expect(target.id).toBe(CLEARFRAME_TARGET_ID);
        expect(target.label).toBe('ClearFrame');
    });

    it('launches ClearFrame once with the paths as arguments', async () => {
        const { target, launch } = makeTarget();
        const paths = ['C:\\a.jpg', 'C:\\b.jpg'];

        const result = await target.send(paths, settings());

        expect(launch).toHaveBeenCalledOnce();
        expect(launch).toHaveBeenCalledWith(EXE, paths);
        expect(result).toEqual({ ok: true, handedOver: 2, batches: 1 });
    });

    it('launches several times, in order, when the paths do not fit one command line', async () => {
        const { target, launch } = makeTarget();
        const paths = Array.from({ length: 10 }, (_, i) => `C:\\Photos\\photo-${i}.jpg`);
        const maxCommandChars = quotedLength(EXE) + 4 * quotedLength(paths[0]);

        const result = await target.send(paths, settings({ maxCommandChars }));

        expect(launch.mock.calls.map(call => (call as unknown as [string, string[]])[1].length)).toEqual([4, 4, 2]);
        expect(launch.mock.calls.flatMap(call => (call as unknown as [string, string[]])[1])).toEqual(paths);
        expect(result).toEqual({ ok: true, handedOver: 10, batches: 3 });
    });

    describe('waiting for ClearFrame between launches', () => {
        const tenPaths = Array.from({ length: 10 }, (_, i) => `C:\\Photos\\photo-${i}.jpg`);
        const fourPerLaunch = quotedLength(EXE) + 4 * quotedLength(tenPaths[0]);

        it('does not wait when everything fits one launch', async () => {
            const { target, wait } = makeTarget();

            await target.send(['C:\\a.jpg', 'C:\\b.jpg'], settings());

            expect(wait).not.toHaveBeenCalled();
        });

        it('waits before every launch after the first, not before the first', async () => {
            const order: string[] = [];
            const launch = vi.fn(async () => { order.push('launch'); });
            const { target } = makeTarget(launch, undefined, async () => { order.push('wait'); return true; });

            await target.send(tenPaths, settings({ maxCommandChars: fourPerLaunch }));

            expect(order).toEqual(['launch', 'wait', 'launch', 'wait', 'launch']);
        });

        it('stops and reports what was handed over when ClearFrame never becomes ready', async () => {
            const { target, launch } = makeTarget(undefined, undefined, async () => false);

            const result = await target.send(tenPaths, settings({ maxCommandChars: fourPerLaunch }));

            expect(launch).toHaveBeenCalledOnce();
            expect(result).toEqual({ ok: false, reason: 'launch_failed', handedOver: 4, batches: 1 });
        });
    });

    it('stops at the first failed launch and reports what was already handed over', async () => {
        const launch = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('spawn failed'));
        const { target } = makeTarget(launch);
        const paths = Array.from({ length: 6 }, (_, i) => `C:\\Photos\\photo-${i}.jpg`);
        const maxCommandChars = quotedLength(EXE) + 2 * quotedLength(paths[0]);

        const result = await target.send(paths, settings({ maxCommandChars }));

        expect(launch).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: false, reason: 'launch_failed', handedOver: 2, batches: 1 });
    });

    it('uses the installed location when no path is configured', async () => {
        const { target, launch } = makeTarget(undefined, () => 'D:\\Apps\\ClearFrame.exe');

        await target.send(['C:\\a.jpg'], settings({ clearFrameExecutablePath: undefined }));

        expect(launch).toHaveBeenCalledWith('D:\\Apps\\ClearFrame.exe', ['C:\\a.jpg']);
    });

    it('reports not_configured when ClearFrame cannot be found, and launches nothing', async () => {
        const { target, launch } = makeTarget();

        const result = await target.send(['C:\\a.jpg'], settings({ clearFrameExecutablePath: undefined }));

        expect(result).toEqual({ ok: false, reason: 'not_configured', handedOver: 0, batches: 0 });
        expect(launch).not.toHaveBeenCalled();
    });

    it('does not send a path that cannot fit any command line, and tells the caller', async () => {
        const { target, launch } = makeTarget();
        const tooLong = `C:\\${'x'.repeat(2000)}.jpg`;

        const result = await target.send(['C:\\ok.jpg', tooLong], settings({ maxCommandChars: 1000 }));

        expect(launch).toHaveBeenCalledWith(EXE, ['C:\\ok.jpg']);
        expect(result).toEqual({ ok: true, handedOver: 1, batches: 1, skippedTooLong: 1 });
    });
});
