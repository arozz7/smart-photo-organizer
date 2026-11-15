import type { SendOutcome, SendSource, SendTargetInfo, SendToSettingsView } from '../types/sendTo';

/** The only place the renderer talks to the main process about "Send to...". */
export const sendToApi = {
    getTargets: (): Promise<SendTargetInfo[]> => window.ipcRenderer.invoke('sendTo:getTargets'),

    send: (targetId: string, source: SendSource, confirmed: boolean): Promise<SendOutcome> =>
        window.ipcRenderer.invoke('sendTo:send', { targetId, source, confirmed }),

    getSettings: (): Promise<SendToSettingsView> => window.ipcRenderer.invoke('sendTo:getSettings'),

    updateSettings: (update: Partial<SendToSettingsView>): Promise<{ success: boolean }> =>
        window.ipcRenderer.invoke('sendTo:updateSettings', update),
};
