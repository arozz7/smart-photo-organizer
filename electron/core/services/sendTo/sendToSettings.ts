import { z } from 'zod';

/** Ask the user to confirm a send larger than this many photos. Configurable (config.json: sendTo.confirmThreshold). */
export const DEFAULT_CONFIRM_THRESHOLD = 50;

/** Windows allows 32,767 characters per command line; stay well below it. */
export const DEFAULT_MAX_COMMAND_CHARS = 24_000;
const MIN_COMMAND_CHARS = 1_000;
const WINDOWS_COMMAND_LIMIT = 32_767;

/** Tunables for the "Send to..." action. Stored under `sendTo` in config.json; all fields optional there. */
export interface SendToSettings {
    /** Sends of more photos than this ask for confirmation first. 0 asks every time. */
    confirmThreshold: number;
    /** Largest command line built for one launch of an editor. */
    maxCommandChars: number;
    /** Where ClearFrame is installed. Undefined means probe the default install folder. */
    clearFrameExecutablePath: string | undefined;
}

const overridesSchema = z.object({
    confirmThreshold: z.number().int().min(0).optional().catch(undefined),
    maxCommandChars: z.number().int().min(MIN_COMMAND_CHARS).max(WINDOWS_COMMAND_LIMIT).optional().catch(undefined),
    clearFrameExecutablePath: z.string().trim().min(1).optional().catch(undefined),
}).catch({});

/** Applies user overrides on top of the defaults. Anything invalid is ignored (never throws). */
export function resolveSendToSettings(overrides: unknown): SendToSettings {
    const parsed = overridesSchema.parse(overrides);
    return {
        confirmThreshold: parsed.confirmThreshold ?? DEFAULT_CONFIRM_THRESHOLD,
        maxCommandChars: parsed.maxCommandChars ?? DEFAULT_MAX_COMMAND_CHARS,
        clearFrameExecutablePath: parsed.clearFrameExecutablePath,
    };
}
