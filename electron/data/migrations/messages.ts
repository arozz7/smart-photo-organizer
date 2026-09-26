import { MigrationError, type MigrationResult } from './types';

export interface UserMessage {
    title: string;
    message: string;
}

/** Plain-language text for a failed upgrade. Pure, so it can be tested without Electron. */
export function describeMigrationFailure(error: MigrationError): UserMessage {
    const outcome = error.backupPath
        ? `Your library was not modified by the failed step (it was rolled back). A backup taken just before the upgrade is at:\n${error.backupPath}`
        : 'No changes were made to your library.';

    return {
        title: 'Library upgrade failed',
        message: `${error.message}.\n\n${outcome}\n\nSmart Photo Organizer will now close. Your photos are untouched. If this keeps happening, please report it and keep the backup file.`,
    };
}

/** Plain-language, non-alarming text for a library written by a newer app version. */
export function describeDowngrade(result: MigrationResult): UserMessage {
    return {
        title: 'This library was used by a newer version',
        message: `This library was last opened by a newer version of Smart Photo Organizer (library format ${result.fromVersion}). It will still open and work here, but some newer features may be unavailable or ignore newer data. It is safe to continue.`,
    };
}
