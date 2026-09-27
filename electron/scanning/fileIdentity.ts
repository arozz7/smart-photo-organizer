import { promises as fs } from 'node:fs';

/** What identifies "this exact file on disk" without reading its contents. */
export interface FileIdentity {
    /** Size in bytes. */
    size: number;
    /** Last-modified time, milliseconds since the epoch. */
    mtime: number;
    /** Volume + filesystem file index; survives rename/move on the same volume. Null if the filesystem gives none. */
    fileId: string | null;
}

/**
 * FAT stores modification times in 2-second steps, and some tools round timestamps, so a difference this small
 * is not evidence of an edit.
 */
export const MTIME_TOLERANCE_MS = 2000;

/**
 * Volume serial + file index, e.g. "5:281474976710695". The volume is included so equal indexes on two
 * different drives never look like the same file. Some filesystems (network shares, certain exFAT setups)
 * report an index of 0, which is not usable, so it becomes null.
 * BigInt keeps 64-bit indexes exact; a JavaScript number would silently round them.
 */
export function toFileId(dev: bigint, ino: bigint): string | null {
    return ino === 0n ? null : `${dev}:${ino}`;
}

/** Reads a file's identity, or null if it cannot be stat'ed (missing, no permission, offline drive). */
export async function readFileIdentity(filePath: string): Promise<FileIdentity | null> {
    try {
        const stats = await fs.stat(filePath, { bigint: true });
        return {
            size: Number(stats.size),
            mtime: Number(stats.mtimeMs),
            fileId: toFileId(stats.dev, stats.ino),
        };
    } catch {
        return null;
    }
}

export type IdentityVerdict =
    /** Nothing recorded yet: fill it in; this is not evidence of an edit. */
    | 'identity-missing'
    | 'unchanged'
    | 'changed'
    /** Same size but a different timestamp: only the content hash can tell "touched" from "edited". */
    | 'needs-hash-check';

/** Compares what was recorded at the last scan with what is on disk now. */
export function compareIdentity(
    stored: { size: number | null; mtime: number | null },
    current: FileIdentity,
): IdentityVerdict {
    if (stored.size === null || stored.mtime === null) return 'identity-missing';
    if (stored.size !== current.size) return 'changed';
    if (Math.abs(stored.mtime - current.mtime) <= MTIME_TOLERANCE_MS) return 'unchanged';
    return 'needs-hash-check';
}
