/** What startCrashDumps needs, so it can be tested without Electron. */
export interface CrashDumpDeps {
    crashReporter: { start(options: { uploadToServer: boolean; compress: boolean; productName: string }): void };
    logger: { info(message: string): void; warn(message: string): void };
    /** The folder Electron writes crash dumps to (`app.getPath('crashDumps')`). */
    dumpsDir: string;
    /** The dump files already there (from earlier crashes). */
    listDumps: () => string[];
}

/**
 * Turns on Electron's crash reporter for this computer only: a native crash (for example inside the image library) leaves a
 * minidump with the call stack in `dumpsDir`. Nothing is uploaded. Never stops the app from starting.
 */
export function startCrashDumps({ crashReporter, logger, dumpsDir, listDumps }: CrashDumpDeps): void {
    try {
        crashReporter.start({ uploadToServer: false, compress: false, productName: 'Smart Photo Organizer' });
        logger.info(`[CrashDumps] Local crash dumps are written to ${dumpsDir}; nothing is uploaded.`);
        const earlier = listDumps();
        if (earlier.length > 0) logger.warn(`[CrashDumps] ${earlier.length} crash dumps from earlier sessions are in ${dumpsDir}.`);
    } catch (error) {
        logger.warn(`[CrashDumps] Could not start the crash reporter: ${String(error)}`);
    }
}
