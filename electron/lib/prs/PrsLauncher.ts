import { spawn } from 'child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PrsClient } from './PrsClient';
import logger from '../../logger';

const LAUNCH_POLL_INTERVAL_MS = 500;
const LAUNCH_TIMEOUT_MS = 20_000;

/** Prevents concurrent spawn attempts when multiple callers check availability simultaneously. */
let launchPromise: Promise<PrsLaunchResult> | null = null;

export type PrsLaunchResult =
    | { ok: true }
    | { ok: false; reason: 'not_configured' | 'launch_failed' | 'timeout' };

/**
 * Ensure Photo Repair Shop is running.
 * 1. If already healthy → { ok: true }
 * 2. If no executablePath configured → { ok: false, reason: 'not_configured' }
 * 3. Launch the exe headless and poll health for up to 20 s
 */
export function ensurePrsRunning(executablePath?: string): Promise<PrsLaunchResult> {
    // If a launch is already in progress, share the same promise so we don't spawn twice.
    if (launchPromise) return launchPromise;

    launchPromise = _doEnsurePrsRunning(executablePath).finally(() => {
        launchPromise = null;
    });
    return launchPromise;
}

async function _doEnsurePrsRunning(executablePath?: string): Promise<PrsLaunchResult> {
    const client = new PrsClient('');

    if (await client.checkHealth()) {
        return { ok: true };
    }

    // Resolution order: user-configured path → NSIS default probe → not_configured
    const exePath = executablePath ?? probeNsisDefaultPath();
    if (!exePath) {
        return { ok: false, reason: 'not_configured' };
    }

    logger.info({ exePath }, '[PrsLauncher] Launching PRS executable');
    try {
        // HEADLESS env var works for all exe types (NSIS-installed, portable wrapper, unpacked).
        // The --headless flag is NOT forwarded by the portable wrapper, so env var is used instead.
        // detached + stdio:'ignore' + unref() lets PRS outlive SPO's process tree.
        const child = spawn(exePath, [], {
            env: { ...process.env, HEADLESS: 'true' },
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
    } catch (e) {
        logger.warn({ error: e }, '[PrsLauncher] spawn failed');
        return { ok: false, reason: 'launch_failed' };
    }

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await sleep(LAUNCH_POLL_INTERVAL_MS);
        if (await client.checkHealth()) {
            logger.info('[PrsLauncher] PRS is now healthy');
            return { ok: true };
        }
    }

    logger.warn('[PrsLauncher] PRS did not become healthy within timeout');
    return { ok: false, reason: 'timeout' };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Probe the NSIS default install path for Photo Repair Shop.
 * Returns the path if the exe exists, or null if not installed there.
 */
export function probeNsisDefaultPath(): string | null {
    const candidate = path.join(
        process.env.LOCALAPPDATA ?? '',
        'Programs', 'Photo Repair Shop', 'Photo Repair Shop.exe',
    );
    return existsSync(candidate) ? candidate : null;
}
