import { describe, it, expect, vi } from 'vitest';
import { SendToService } from '../../../../electron/core/services/sendTo/SendToService';
import type { PhotoPathRow, PhotoPathSource } from '../../../../electron/core/services/sendTo/PhotoPathSource';
import type { SendTarget } from '../../../../electron/core/services/sendTo/SendTarget';
import { DEFAULT_MAX_COMMAND_CHARS, type SendToSettings } from '../../../../electron/core/services/sendTo/sendToSettings';

const row = (id: number, missingSince: string | null = null): PhotoPathRow => ({ id, filePath: `C:\\Photos\\p${id}.jpg`, missingSince });

const makeSettings = (overrides: Partial<SendToSettings> = {}): SendToSettings => ({
    confirmThreshold: 50,
    maxCommandChars: DEFAULT_MAX_COMMAND_CHARS,
    clearFrameExecutablePath: undefined,
    ...overrides,
});

const makeTarget = (): SendTarget & { send: ReturnType<typeof vi.fn> } => ({
    id: 'clearframe',
    label: 'ClearFrame',
    send: vi.fn(async (paths: string[]) => ({ ok: true as const, handedOver: paths.length, batches: 1 })),
});

const makeSource = (rows: PhotoPathRow[], albums: Record<number, PhotoPathRow[]> = {}): PhotoPathSource => ({
    pathsForPhotoIds: vi.fn((ids: number[]) => ids.map(id => rows.find(r => r.id === id)).filter((r): r is PhotoPathRow => r !== undefined)),
    pathsForSmartAlbum: vi.fn((albumId: number) => albums[albumId] ?? null),
});

const build = (options: {
    rows?: PhotoPathRow[];
    albums?: Record<number, PhotoPathRow[]>;
    missingOnDisk?: string[];
    settings?: Partial<SendToSettings>;
    target?: SendTarget;
}) => {
    const target = options.target ?? makeTarget();
    const service = new SendToService({
        source: makeSource(options.rows ?? [], options.albums),
        fileExists: async filePath => !(options.missingOnDisk ?? []).includes(filePath),
        targets: [target],
        getSettings: () => makeSettings(options.settings),
    });
    return { service, target };
};

describe('SendToService', () => {
    it('hands the stored paths of a selection to the target and counts them', async () => {
        const { service, target } = build({ rows: [row(1), row(2), row(3)] });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 2, 3] } });

        expect(outcome).toEqual({ status: 'sent', counts: { requested: 3, missing: 0, sent: 3 }, batches: 1 });
        expect(target.send).toHaveBeenCalledWith(['C:\\Photos\\p1.jpg', 'C:\\Photos\\p2.jpg', 'C:\\Photos\\p3.jpg'], expect.anything());
    });

    it('skips photos marked missing and photos whose file is gone, and says how many', async () => {
        const { service, target } = build({
            rows: [row(1), row(2, '2026-11-01'), row(3)],
            missingOnDisk: ['C:\\Photos\\p3.jpg'],
        });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 2, 3] } });

        expect(outcome).toMatchObject({ status: 'sent', counts: { requested: 3, missing: 2, sent: 1 } });
        expect(target.send).toHaveBeenCalledWith(['C:\\Photos\\p1.jpg'], expect.anything());
    });

    it('counts a requested id that is no longer in the library as missing', async () => {
        const { service } = build({ rows: [row(1)] });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 99] } });

        expect(outcome).toMatchObject({ status: 'sent', counts: { requested: 2, missing: 1, sent: 1 } });
    });

    it('sends each file once even when the selection repeats a photo', async () => {
        const { service, target } = build({ rows: [row(1)] });

        await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 1] } });

        expect(target.send).toHaveBeenCalledWith(['C:\\Photos\\p1.jpg'], expect.anything());
    });

    it('resolves a Smart Album to its photos', async () => {
        const { service, target } = build({ albums: { 7: [row(10), row(11)] } });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'smartAlbum', albumId: 7 } });

        expect(outcome).toMatchObject({ status: 'sent', counts: { requested: 2, sent: 2 } });
        expect(target.send).toHaveBeenCalledOnce();
    });

    it('fails without calling the target when the album does not exist', async () => {
        const { service, target } = build({});

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'smartAlbum', albumId: 404 } });

        expect(outcome).toEqual({ status: 'failed', reason: 'unknown_source', counts: { requested: 0, missing: 0, sent: 0 } });
        expect(target.send).not.toHaveBeenCalled();
    });

    it('fails when the target is not registered', async () => {
        const { service } = build({ rows: [row(1)] });

        const outcome = await service.send({ targetId: 'darktable', source: { kind: 'photos', ids: [1] } });

        expect(outcome).toMatchObject({ status: 'failed', reason: 'unknown_target' });
    });

    it('fails without launching when every photo is missing', async () => {
        const { service, target } = build({ rows: [row(1, '2026-11-01')] });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1] } });

        expect(outcome).toEqual({ status: 'failed', reason: 'nothing_to_send', counts: { requested: 1, missing: 1, sent: 0 } });
        expect(target.send).not.toHaveBeenCalled();
    });

    describe('confirmation for large sends', () => {
        const rows = Array.from({ length: 6 }, (_, i) => row(i + 1));
        const ids = rows.map(r => r.id);

        it('asks first when more photos than the threshold would be sent', async () => {
            const { service, target } = build({ rows, settings: { confirmThreshold: 5 } });

            const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids } });

            expect(outcome).toEqual({ status: 'needs_confirmation', counts: { requested: 6, missing: 0, sent: 0 }, sendable: 6, threshold: 5 });
            expect(target.send).not.toHaveBeenCalled();
        });

        it('sends once the user has confirmed', async () => {
            const { service, target } = build({ rows, settings: { confirmThreshold: 5 } });

            const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids }, confirmed: true });

            expect(outcome).toMatchObject({ status: 'sent', counts: { sent: 6 } });
            expect(target.send).toHaveBeenCalledOnce();
        });

        it('does not ask when the count equals the threshold', async () => {
            const { service } = build({ rows, settings: { confirmThreshold: 6 } });

            const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids } });

            expect(outcome.status).toBe('sent');
        });

        it('counts only sendable photos against the threshold', async () => {
            const withMissing = [...rows.slice(0, 5), row(6, '2026-11-01')];
            const { service } = build({ rows: withMissing, settings: { confirmThreshold: 5 } });

            const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids } });

            expect(outcome.status).toBe('sent');
        });

        it('asks every time when the threshold is 0', async () => {
            const { service } = build({ rows: [row(1)], settings: { confirmThreshold: 0 } });

            const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1] } });

            expect(outcome.status).toBe('needs_confirmation');
        });

        it('uses the threshold that is current at send time (it can be changed while the app runs)', async () => {
            let threshold = 100;
            const target = makeTarget();
            const service = new SendToService({
                source: makeSource(rows),
                fileExists: async () => true,
                targets: [target],
                getSettings: () => makeSettings({ confirmThreshold: threshold }),
            });
            const request = { targetId: 'clearframe', source: { kind: 'photos' as const, ids } };

            const before = await service.send(request);
            threshold = 2;
            const after = await service.send(request);

            expect(before.status).toBe('sent');
            expect(after.status).toBe('needs_confirmation');
        });
    });

    it('reports a target failure with the number already handed over', async () => {
        const target: SendTarget = {
            id: 'clearframe',
            label: 'ClearFrame',
            send: async () => ({ ok: false, reason: 'launch_failed', handedOver: 2, batches: 1 }),
        };
        const { service } = build({ rows: [row(1), row(2), row(3)], target });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 2, 3] } });

        expect(outcome).toEqual({ status: 'failed', reason: 'launch_failed', counts: { requested: 3, missing: 0, sent: 2 } });
    });

    it('reports paths that were too long to send', async () => {
        const target: SendTarget = {
            id: 'clearframe',
            label: 'ClearFrame',
            send: async () => ({ ok: true, handedOver: 1, batches: 1, skippedTooLong: 1 }),
        };
        const { service } = build({ rows: [row(1), row(2)], target });

        const outcome = await service.send({ targetId: 'clearframe', source: { kind: 'photos', ids: [1, 2] } });

        expect(outcome).toEqual({ status: 'sent', counts: { requested: 2, missing: 0, sent: 1, tooLong: 1 }, batches: 1 });
    });

    it('lists the registered targets for the UI', () => {
        const { service } = build({});

        expect(service.listTargets()).toEqual([{ id: 'clearframe', label: 'ClearFrame' }]);
    });
});
