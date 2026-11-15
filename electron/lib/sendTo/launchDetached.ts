import { spawn } from 'node:child_process';

/**
 * Starts a program and leaves it running on its own, so it outlives SPO. Resolves as soon as the
 * operating system has started it and rejects if it could not be started (for example a wrong path).
 * Arguments go straight to the program: no shell, so no quoting or injection concerns.
 */
export function launchDetached(executablePath: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(executablePath, [...args], { detached: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}
