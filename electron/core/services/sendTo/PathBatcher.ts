export interface BatchOptions {
    /** The program being launched; its quoted path counts toward the command line. */
    exePath: string;
    /** Largest command line to build, in characters (Windows allows 32,767 in total). */
    maxCommandChars: number;
}

export interface BatchResult {
    /** Groups of paths, in the original order, each safe to pass in one launch. */
    batches: string[][];
    /** Paths that cannot fit in any command line. They are reported, never sent. */
    oversized: string[];
}

/**
 * Characters one argument adds to a Windows command line: the text, two quotes and a separating space.
 * Backslashes at the very end are doubled so they cannot escape the closing quote. Always assuming
 * quotes makes the estimate slightly high, which is the safe direction.
 */
export function quotedLength(argument: string): number {
    const trailingBackslashes = /\\*$/.exec(argument)?.[0].length ?? 0;
    return argument.length + trailingBackslashes + 3;
}

/** Splits paths into command-line sized groups. Pure: no file access. */
export function batchPaths(paths: readonly string[], options: BatchOptions): BatchResult {
    const budget = options.maxCommandChars - quotedLength(options.exePath);
    const batches: string[][] = [];
    const oversized: string[] = [];
    let current: string[] = [];
    let used = 0;

    for (const filePath of paths) {
        const cost = quotedLength(filePath);
        if (cost > budget) {
            oversized.push(filePath);
            continue;
        }
        if (used + cost > budget) {
            batches.push(current);
            current = [];
            used = 0;
        }
        current.push(filePath);
        used += cost;
    }

    if (current.length > 0) batches.push(current);
    return { batches, oversized };
}
