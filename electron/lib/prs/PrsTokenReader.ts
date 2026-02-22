import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const TOKEN_PATH = path.join(os.homedir(), '.photo-repair-shop', 'api-token');

/**
 * Read the PRS API token from the well-known token file.
 * Returns null if PRS has never run or the file does not exist.
 * Never logs the token value.
 */
export function readPrsToken(): string | null {
    try {
        return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    } catch {
        return null;
    }
}
