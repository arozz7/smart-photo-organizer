import { useCallback, useEffect, useState } from 'react';
import type { SendToSettingsView } from '../types/sendTo';
import { sendToApi } from '../utils/sendToApi';

/** Reads and saves the "Send to..." settings (confirm threshold, ClearFrame location). */
export function useSendToSettings() {
    const [settings, setSettings] = useState<SendToSettingsView | null>(null);

    useEffect(() => {
        sendToApi.getSettings().then(setSettings).catch(() => setSettings(null));
    }, []);

    const update = useCallback(async (change: Partial<SendToSettingsView>): Promise<boolean> => {
        try {
            const { success } = await sendToApi.updateSettings(change);
            if (success) setSettings(current => (current ? { ...current, ...change } : current));
            return success;
        } catch {
            return false;
        }
    }, []);

    return { settings, update };
}
