import { z } from 'zod';
import type { SendRequest } from './SendToService';
import type { SendToSettings } from './sendToSettings';

/** A library can hold hundreds of thousands of photos; one send is limited far below that. */
export const MAX_SELECTION_IDS = 100_000;

const id = z.number().int().positive();

const sendRequestSchema = z.object({
    targetId: z.string().min(1),
    source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('photos'), ids: z.array(id).min(1).max(MAX_SELECTION_IDS) }),
        z.object({ kind: z.literal('smartAlbum'), albumId: id }),
    ]),
    confirmed: z.boolean().optional(),
});

/**
 * Validates a "Send to..." request from the renderer. Only ids and a target name are accepted, never
 * file paths or program paths; unknown fields are dropped. Returns null when the payload is invalid.
 */
export function parseSendRequest(payload: unknown): SendRequest | null {
    const parsed = sendRequestSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
}

const settingsUpdateSchema = z.object({
    confirmThreshold: z.number().int().min(0).optional(),
    /** Empty clears the setting, so the default install location is used. */
    clearFrameExecutablePath: z.string().optional(),
});

/** Validates a settings change from the Settings screen. Only the user-facing fields are accepted. */
export function parseSendToSettingsUpdate(payload: unknown): Partial<Pick<SendToSettings, 'confirmThreshold' | 'clearFrameExecutablePath'>> | null {
    const parsed = settingsUpdateSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
}
