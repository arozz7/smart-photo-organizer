import { app, dialog } from 'electron';
import { describeDowngrade, describeMigrationFailure } from '../data/migrations/messages';
import type { MigrationError, MigrationResult } from '../data/migrations/types';

/** Blocking error dialog for a failed upgrade, then quit (fail closed: no services run on the library). */
export function reportMigrationFailureAndQuit(error: MigrationError): void {
    const { title, message } = describeMigrationFailure(error);
    dialog.showErrorBox(title, message);
    app.quit();
}

/** Non-blocking notice that the library came from a newer app version. */
export function notifyDowngrade(result: MigrationResult): void {
    const { title, message } = describeDowngrade(result);
    void dialog.showMessageBox({ type: 'info', title, message, buttons: ['OK'] });
}
