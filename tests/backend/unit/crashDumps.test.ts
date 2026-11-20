import { describe, it, expect, vi } from 'vitest';
import { startCrashDumps } from '../../../electron/lib/crashDumps';

const make = (existing: string[] = []) => {
    const crashReporter = { start: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const listDumps = vi.fn(() => existing);
    return { crashReporter, logger, listDumps };
};

describe('startCrashDumps', () => {
    it('keeps crash dumps on this computer: nothing is uploaded', () => {
        const { crashReporter, logger, listDumps } = make();

        startCrashDumps({ crashReporter, logger, dumpsDir: 'C:\\dumps', listDumps });

        expect(crashReporter.start).toHaveBeenCalledTimes(1);
        expect(crashReporter.start).toHaveBeenCalledWith(expect.objectContaining({ uploadToServer: false, compress: false }));
        expect(crashReporter.start.mock.calls[0][0]).not.toHaveProperty('submitURL');
    });

    it('says where the dumps go', () => {
        const { crashReporter, logger, listDumps } = make();

        startCrashDumps({ crashReporter, logger, dumpsDir: 'C:\\dumps', listDumps });

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('C:\\dumps'));
    });

    it('warns when dumps from earlier crashes are waiting', () => {
        const { crashReporter, logger, listDumps } = make(['a.dmp', 'b.dmp']);

        startCrashDumps({ crashReporter, logger, dumpsDir: 'C:\\dumps', listDumps });

        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/2 crash dumps/));
    });

    it('does not stop the app from starting when the crash reporter cannot start', () => {
        const { crashReporter, logger, listDumps } = make();
        crashReporter.start.mockImplementation(() => { throw new Error('no handler'); });

        expect(() => startCrashDumps({ crashReporter, logger, dumpsDir: 'C:\\dumps', listDumps })).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no handler'));
    });
});
