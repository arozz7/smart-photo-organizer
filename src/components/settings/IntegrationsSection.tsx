import { useState, useEffect } from 'react'
import SendToSettingsCard from '../SendToSettingsCard';
import SettingsSection from './SettingsSection';

/** Integrations: where Photo Repair Shop is installed, and the Send to ClearFrame settings. */
export default function IntegrationsSection() {
    const [prsExecutablePath, setPrsExecutablePath] = useState('');

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('settings:get').then((cfg: any) => {
            if (cfg?.prsExecutablePath) setPrsExecutablePath(cfg.prsExecutablePath);
        });
    }, [])

    return (
        <SettingsSection title="Integrations" className="space-y-4 pt-8">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                <div>
                    <h4 className="font-medium text-white">Photo Repair Shop location</h4>
                    <p className="text-sm text-gray-400 mt-1 mb-3">
                        Path to the Photo Repair Shop executable. Required to launch PRS automatically when repairing corrupt files.{' '}
                        Don't have it?{' '}
                        <button
                            onClick={() => {
                                // @ts-ignore
                                window.ipcRenderer.invoke('os:openExternal', 'https://github.com/arozz7/photo-repair-shop/releases/tag/v1.0.0');
                            }}
                            className="text-indigo-400 hover:text-indigo-300 underline bg-transparent border-0 p-0 cursor-pointer"
                        >
                            Download from GitHub
                        </button>
                    </p>
                    <div className="flex gap-3 items-center">
                        <input
                            type="text"
                            readOnly
                            value={prsExecutablePath}
                            placeholder="e.g. C:\Users\you\Downloads\Photo Repair Shop-Windows-1.0.0-Portable.exe"
                            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 font-mono cursor-default"
                        />
                        <button
                            onClick={async () => {
                                // @ts-ignore
                                const result = await window.ipcRenderer.invoke('dialog:openFile', {
                                    filters: [{ name: 'Executable', extensions: ['exe'] }],
                                    properties: ['openFile'],
                                });
                                if (result) {
                                    setPrsExecutablePath(result);
                                    // @ts-ignore
                                    await window.ipcRenderer.invoke('settings:update', { prsExecutablePath: result });
                                }
                            }}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 whitespace-nowrap"
                        >
                            Browse...
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                        Point to either the Portable .exe or the installed Photo Repair Shop.exe
                    </p>
                </div>
            </div>
            <SendToSettingsCard />
        </SettingsSection>
    )
}
