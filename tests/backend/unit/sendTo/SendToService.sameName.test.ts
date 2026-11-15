import { describe, it, expect, vi } from 'vitest';
import { SendToService, type SendToDeps } from '../../../../electron/core/services/sendTo/SendToService';
import { ClearFrameTarget } from '../../../../electron/core/services/sendTo/ClearFrameTarget';
import { quotedLength } from '../../../../electron/core/services/sendTo/PathBatcher';
import type { PhotoPathRow } from '../../../../electron/core/services/sendTo/PhotoPathSource';
import { DEFAULT_MAX_COMMAND_CHARS, type SendToSettings } from '../../../../electron/core/services/sendTo/sendToSettings';

/**
 * A camera counter that wraps gives different photos the same file name, and a RAW and a JPEG share
 * a name in one folder. Files are identified by their FULL path, never by their name.
 */
const EXE = 'C:\\Users\\me\\AppData\\Local\\ClearFrame\\cf-app.exe';

const row = (id: number, filePath: string, missingSince: string | null = null): PhotoPathRow => ({ id, filePath, missingSince });

const build = (rows: PhotoPathRow[], options: { maxCommandChars?: number; caseInsensitivePaths?: boolean; missingOnDisk?: string[] } = {}) => {
    const launch = vi.fn(async (_exe: string, _paths: string[]) => undefined);
    const target = new ClearFrameTarget({ launch, probeInstalledPath: () => null, waitUntilReady: async () => true });
    const settings: SendToSettings = {
        confirmThreshold: 1000,
        maxCommandChars: options.maxCommandChars ?? DEFAULT_MAX_COMMAND_CHARS,
        clearFrameExecutablePath: EXE,
    };
    const deps: SendToDeps = {
        source: {
            pathsForPhotoIds: ids => ids.map(id => rows.find(r => r.id === id)).filter((r): r is PhotoPathRow => r !== undefined),
            pathsForSmartAlbum: () => rows,
        },
        fileExists: async filePath => !(options.missingOnDisk ?? []).includes(filePath),
        targets: [target],
        getSettings: () => settings,
        caseInsensitivePaths: options.caseInsensitivePaths ?? false,
    };
    return { service: new SendToService(deps), launch };
};

const sendAll = (service: SendToService, ids: number[]) =>
    service.send({ targetId: 'clearframe', source: { kind: 'photos', ids } });

const launchedPaths = (launch: ReturnType<typeof vi.fn>) => launch.mock.calls.map(call => call[1] as string[]);

describe('Send to... with same-named files', () => {
    const a = 'D:\\Trip 2019\\DSC00001.ARW';
    const b = 'D:\\Trip 2024\\DSC00001.ARW';

    it('sends both photos that have the same name in different folders (one launch)', async () => {
        const { service, launch } = build([row(1, a), row(2, b)]);

        const outcome = await sendAll(service, [1, 2]);

        expect(launchedPaths(launch)).toEqual([[a, b]]);
        expect(outcome).toEqual({ status: 'sent', counts: { requested: 2, missing: 0, sent: 2 }, batches: 1 });
    });

    it('sends both when they land in different launches (across a batch boundary)', async () => {
        const maxCommandChars = quotedLength(EXE) + quotedLength(a); // room for exactly one path per launch
        const { service, launch } = build([row(1, a), row(2, b)], { maxCommandChars });

        const outcome = await sendAll(service, [1, 2]);

        expect(launchedPaths(launch)).toEqual([[a], [b]]);
        expect(outcome).toEqual({ status: 'sent', counts: { requested: 2, missing: 0, sent: 2 }, batches: 2 });
    });

    it('sends a RAW and a JPEG with the same name in one folder', async () => {
        const raw = 'D:\\Shoot\\DSC00002.ARW';
        const jpeg = 'D:\\Shoot\\DSC00002.JPG';
        const { service, launch } = build([row(1, raw), row(2, jpeg)]);

        const outcome = await sendAll(service, [1, 2]);

        expect(launchedPaths(launch)).toEqual([[raw, jpeg]]);
        expect(outcome).toMatchObject({ status: 'sent', counts: { sent: 2 } });
    });

    it('counts the sent and skipped photos right when same-named photos are partly missing', async () => {
        const c = 'D:\\Trip 2025\\DSC00001.ARW';
        const { service, launch } = build([row(1, a), row(2, b, '2026-11-01'), row(3, c)], { missingOnDisk: [c] });

        const outcome = await sendAll(service, [1, 2, 3]);

        expect(launchedPaths(launch)).toEqual([[a]]);
        expect(outcome).toMatchObject({ status: 'sent', counts: { requested: 3, missing: 2, sent: 1 } });
    });

    it('does not merge two different photos just because their names match, even from a Smart Album', async () => {
        const { service, launch } = build([row(1, a), row(2, b)]);

        await service.send({ targetId: 'clearframe', source: { kind: 'smartAlbum', albumId: 1 } });

        expect(launchedPaths(launch)).toEqual([[a, b]]);
    });
});

describe('Send to... with the same file stored under two letter cases', () => {
    const lower = 'd:\\photos\\holiday\\a.jpg';
    const mixed = 'D:\\Photos\\Holiday\\A.JPG';

    it('sends the file once on Windows, where paths ignore letter case', async () => {
        const { service, launch } = build([row(1, lower), row(2, mixed)], { caseInsensitivePaths: true });

        const outcome = await sendAll(service, [1, 2]);

        expect(launchedPaths(launch)).toEqual([[lower]]);
        // The second row is the same file, not a missing one, so it is not reported as missing.
        expect(outcome).toMatchObject({ status: 'sent', counts: { requested: 2, missing: 0, sent: 1 } });
    });

    it('keeps both where paths are case-sensitive', async () => {
        const { service, launch } = build([row(1, lower), row(2, mixed)], { caseInsensitivePaths: false });

        await sendAll(service, [1, 2]);

        expect(launchedPaths(launch)).toEqual([[lower, mixed]]);
    });
});
