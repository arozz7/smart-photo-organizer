import path from 'node:path';
import { z } from 'zod';

/** The two native pickers the app opens: one chooses a folder, the other a file. */
export type PickerKind = 'directory' | 'file';

/** Where each picker last succeeded. Stored under `lastPickerFolders` in config.json. */
export type PickerFolders = Partial<Record<PickerKind, string>>;

const savedFoldersSchema = z.object({
    directory: z.string().trim().min(1).optional().catch(undefined),
    file: z.string().trim().min(1).optional().catch(undefined),
}).catch({});

/** The folder to remember after the user picked `selectedPath`. */
export function folderToRemember(kind: PickerKind, selectedPath: string): string {
    return kind === 'directory' ? selectedPath : path.dirname(selectedPath);
}

/**
 * The folder a picker should open in: the saved one, if it still exists.
 * Electron 43 stopped remembering the last folder itself, so the app does.
 * Invalid saved values are ignored (never throws).
 */
export function startFolderFor(
    kind: PickerKind,
    saved: unknown,
    exists: (folder: string) => boolean
): string | undefined {
    const folder = savedFoldersSchema.parse(saved)[kind];
    return folder !== undefined && exists(folder) ? folder : undefined;
}
