import { app } from 'electron';
import path from 'node:path';

// --- DEV MODE CONFIG SEPARATION ---
// This must run before any other imports that access app.getPath('userData')
if (process.env['VITE_DEV_SERVER_URL']) {
    const appData = app.getPath('appData');
    const devUserData = path.join(appData, 'smart-photo-organizer-dev');
    app.setPath('userData', devUserData);

    // We cannot use logger here as it's not initialized (and would cause circular dependency/race)
    console.log(`[Setup] Dev Mode detected. Redirecting userData to: ${devUserData}`);
}
