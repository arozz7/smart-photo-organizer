import { useEffect, useState } from 'react';
import { useSendToSettings } from '../hooks/useSendToSettings';

const CLEARFRAME_DEFAULT_HINT = '%LOCALAPPDATA%\\ClearFrame\\cf-app.exe';

/** Settings for "Send to...": when to ask before a large send, and where ClearFrame is installed. */
export default function SendToSettingsCard() {
    const { settings, update } = useSendToSettings();
    const [threshold, setThreshold] = useState('');

    useEffect(() => {
        if (settings) setThreshold(String(settings.confirmThreshold));
    }, [settings]);

    if (!settings) return null;

    const saveThreshold = () => {
        const value = Number(threshold);
        if (Number.isInteger(value) && value >= 0) {
            void update({ confirmThreshold: value });
        } else {
            setThreshold(String(settings.confirmThreshold));
        }
    };

    const browseForClearFrame = async () => {
        const result = await window.ipcRenderer.invoke('dialog:openFile', {
            filters: [{ name: 'Executable', extensions: ['exe'] }],
            properties: ['openFile'],
        });
        if (result) void update({ clearFrameExecutablePath: result });
    };

    return (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-5">
            <div>
                <h4 className="font-medium text-white">Send to… (ClearFrame)</h4>
                <p className="text-sm text-gray-400 mt-1">
                    Sends the file paths of your photos to another program. Nothing is copied, moved or changed.
                </p>
            </div>

            <div>
                <label htmlFor="send-to-threshold" className="block text-sm text-gray-300 mb-1">
                    Ask before sending more than this many photos
                </label>
                <input
                    id="send-to-threshold"
                    type="number"
                    min={0}
                    value={threshold}
                    onChange={event => setThreshold(event.target.value)}
                    onBlur={saveThreshold}
                    className="w-28 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                />
                <p className="text-xs text-gray-500 mt-1">Use 0 to be asked every time.</p>
            </div>

            <div>
                <div className="block text-sm text-gray-300 mb-1">ClearFrame location</div>
                <div className="flex gap-3 items-center">
                    <input
                        type="text"
                        readOnly
                        aria-label="ClearFrame location"
                        value={settings.clearFrameExecutablePath}
                        placeholder={CLEARFRAME_DEFAULT_HINT}
                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 font-mono cursor-default"
                    />
                    <button
                        onClick={browseForClearFrame}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 whitespace-nowrap"
                    >
                        Browse...
                    </button>
                    {settings.clearFrameExecutablePath && (
                        <button
                            onClick={() => void update({ clearFrameExecutablePath: '' })}
                            className="px-3 py-2 rounded-md text-sm text-gray-300 hover:text-white whitespace-nowrap"
                        >
                            Use default
                        </button>
                    )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Leave empty to use the default install location ({CLEARFRAME_DEFAULT_HINT}).
                </p>
            </div>
        </div>
    );
}
