import path from 'node:path';

export const CLEARFRAME_EXECUTABLE_NAME = 'cf-app.exe';
/** Part of the title of ClearFrame's main window. */
export const CLEARFRAME_WINDOW_TITLE = 'ClearFrame';

/**
 * Default install location (current-user installer): %LOCALAPPDATA%\ClearFrame\cf-app.exe.
 * Returns null when it is not there; the user can then set the path by hand.
 */
export function probeClearFrameInstall(
    env: Readonly<Record<string, string | undefined>>,
    exists: (filePath: string) => boolean,
): string | null {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) return null;
    const candidate = path.win32.join(localAppData, 'ClearFrame', CLEARFRAME_EXECUTABLE_NAME);
    return exists(candidate) ? candidate : null;
}

/** Window titles from `tasklist /v /fo csv` output (the title is the last column; the first line is the header). */
export function parseTasklistWindowTitles(csv: string): string[] {
    return csv
        .split(/\r?\n/)
        .slice(1)
        .filter(line => line.startsWith('"'))
        .map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replace(/""/g, '"')))
        .map(fields => fields[fields.length - 1] ?? '');
}

export interface WaitForWindowDeps {
    /** Titles of the windows of running ClearFrame processes. */
    listWindowTitles(): Promise<string[]>;
    now(): number;
    sleep(ms: number): Promise<void>;
    timeoutMs: number;
    pollMs: number;
}

/**
 * Waits until ClearFrame has a window, so a further launch is handed to the running program and does
 * not race its start-up (a known ClearFrame issue until its fix ships; drop the wait then).
 * Resolves false on timeout. Never throws.
 */
export async function waitForClearFrameWindow(deps: WaitForWindowDeps): Promise<boolean> {
    const deadline = deps.now() + deps.timeoutMs;
    while (true) {
        try {
            const titles = await deps.listWindowTitles();
            if (titles.some(title => title.toLowerCase().includes(CLEARFRAME_WINDOW_TITLE.toLowerCase()))) return true;
        } catch {
            // A failed listing counts as "not ready yet"; the deadline ends the wait.
        }
        if (deps.now() >= deadline) return false;
        await deps.sleep(deps.pollMs);
    }
}
