
import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Slider from '@radix-ui/react-slider';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Tabs from '@radix-ui/react-tabs';
import { InfoCircledIcon, DownloadIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useAlert } from '../context/AlertContext';
import ModelDownloader from './ModelDownloader';

interface SettingsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface AISettings {
    faceDetectionThreshold: number;
    faceBlurThreshold: number;
    vlmTemperature: number;
    vlmMaxTokens: number;
    hideUnnamedFacesByDefault: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onOpenChange }) => {
    const { showAlert, showConfirm } = useAlert();
    const [loading, setLoading] = useState(true);
    const [downloaderOpen, setDownloaderOpen] = useState(false);
    const [settings, setSettings] = useState<AISettings>({
        faceDetectionThreshold: 0.6,
        faceBlurThreshold: 20.0,
        vlmTemperature: 0.2,
        vlmMaxTokens: 100,
        hideUnnamedFacesByDefault: false
    });

    useEffect(() => {
        if (open) {
            loadSettings();
        }
    }, [open]);

    const loadSettings = async () => {
        setLoading(true);
        try {
            // @ts-ignore
            const saved = await window.ipcRenderer.invoke('ai:getSettings');
            if (saved) setSettings(saved);
        } catch (e) {
            console.error("Failed to load settings:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            // @ts-ignore
            await window.ipcRenderer.invoke('ai:saveSettings', settings);
            onOpenChange(false);
        } catch (e) {
            console.error("Failed to save settings:", e);
            showAlert({
                title: 'Save Failed',
                description: 'Failed to save settings',
                variant: 'danger'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key: keyof AISettings, value: number) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleReset = () => {
        showConfirm({
            title: 'Reset AI Settings',
            description: 'Reset all AI settings to default values?',
            confirmLabel: 'Reset Defaults',
            onConfirm: () => {
                setSettings({
                    faceDetectionThreshold: 0.6,
                    faceBlurThreshold: 20.0,
                    vlmTemperature: 0.2,
                    vlmMaxTokens: 100,
                    hideUnnamedFacesByDefault: false
                });
            }
        });
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-gray-900 border border-gray-700 p-0 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col max-h-[90vh]">

                    {/* Header */}
                    <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
                        <Dialog.Title className="text-xl font-bold text-white">Settings</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="text-gray-400 hover:text-white" aria-label="Close">
                                <Cross2Icon />
                            </button>
                        </Dialog.Close>
                    </div>

                    <Tabs.Root defaultValue="general" className="flex-1 flex flex-col min-h-0">
                        <div className="px-6 border-b border-gray-800 bg-gray-900/50">
                            <Tabs.List className="flex gap-6">
                                <TabTrigger value="general">General</TabTrigger>
                                <TabTrigger value="tagging">Tagging</TabTrigger>
                                <TabTrigger value="maintenance">Maintenance</TabTrigger>
                            </Tabs.List>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            <Tabs.Content value="general" className="space-y-6 focus:outline-none">
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold text-blue-400">Detection & Recognition</h3>
                                        <button
                                            onClick={() => setDownloaderOpen(true)}
                                            className="flex items-center gap-2 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-xs transition-colors font-medium border border-blue-500/30"
                                        >
                                            <DownloadIcon className="w-3 h-3" />
                                            Manage Models
                                        </button>
                                    </div>

                                    <SettingSlider
                                        label="Face Detection Confidence"
                                        value={settings.faceDetectionThreshold}
                                        min={0.1} max={0.99} step={0.01}
                                        onChange={(v) => handleChange('faceDetectionThreshold', v)}
                                        tooltip="Minimum confidence score (0.0 - 1.0) to detect a face. Higher values reduce false positives (like trees seeing valid faces) but might miss difficult faces."
                                    />

                                    <SettingSlider
                                        label="Blur Rejection Threshold"
                                        value={settings.faceBlurThreshold}
                                        min={0} max={100} step={1}
                                        onChange={(v) => handleChange('faceBlurThreshold', v)}
                                        tooltip="Faces below this sharpness score will be IGNORED during scanning. Use this to prevent blurry faces from cluttering your People list. Typical blurry photos are < 20."
                                    />

                                    <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <label className="text-sm font-medium text-gray-200">Hide Unnamed Faces</label>
                                                <InfoTooltip text="If enabled, face bounding boxes on photos will only show for people you have already named. You can still toggle this manually in the photo viewer." />
                                            </div>
                                            <p className="text-xs text-gray-500">Hide anonymous face crops by default in the photo detail view.</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={settings.hideUnnamedFacesByDefault}
                                            onChange={(e) => setSettings(prev => ({ ...prev, hideUnnamedFacesByDefault: e.target.checked }))}
                                            className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
                                        />
                                    </div>
                                </div>
                            </Tabs.Content>

                            <Tabs.Content value="tagging" className="space-y-6 focus:outline-none">
                                <div className="space-y-6">
                                    <h3 className="text-lg font-semibold text-purple-400">AI Tagging (VLM)</h3>

                                    <SettingSlider
                                        label="Creativity (Temperature)"
                                        value={settings.vlmTemperature}
                                        min={0.0} max={1.5} step={0.1}
                                        onChange={(v) => handleChange('vlmTemperature', v)}
                                        tooltip="Controls randomness in tag generation. Lower (0.1) is more factual/deterministic. Higher (0.8+) is more creative but can hallucinate."
                                    />

                                    <div className="flex flex-col space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <label className="text-sm font-medium text-gray-300">Max Tagging Tokens</label>
                                                <InfoTooltip text="Maximum length of the generated description/tags. 100 is usually enough for concise tags." />
                                            </div>
                                            <span className="text-xs text-blue-400 font-mono bg-blue-900/30 px-2 py-0.5 rounded border border-blue-500/20">{settings.vlmMaxTokens}</span>
                                        </div>
                                        <input
                                            type="number"
                                            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm w-full focus:outline-none focus:border-purple-500"
                                            value={settings.vlmMaxTokens}
                                            onChange={(e) => handleChange('vlmMaxTokens', parseInt(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </Tabs.Content>

                            <Tabs.Content value="maintenance" className="space-y-6 focus:outline-none">
                                <div className="space-y-4">
                                    <h3 className="text-lg font-semibold text-orange-400">Troubleshooting</h3>

                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={async () => {
                                                // @ts-ignore
                                                const path = await window.ipcRenderer.invoke('os:getLogPath');
                                                // @ts-ignore
                                                window.ipcRenderer.invoke('os:showInFolder', path);
                                            }}
                                            className="flex flex-col items-center justify-center gap-2 p-4 bg-gray-800 border border-gray-700 rounded hover:bg-gray-750 transition-colors group"
                                        >
                                            <span className="text-sm font-semibold text-gray-300 group-hover:text-white">View Logs</span>
                                            <span className="text-xs text-gray-500">Open Log Folder</span>
                                        </button>

                                        <button
                                            onClick={async () => {
                                                // @ts-ignore
                                                const path = await window.ipcRenderer.invoke('settings:getLibraryPath');
                                                // @ts-ignore
                                                window.ipcRenderer.invoke('os:openFolder', path);
                                            }}
                                            className="flex flex-col items-center justify-center gap-2 p-4 bg-gray-800 border border-gray-700 rounded hover:bg-gray-750 transition-colors group"
                                        >
                                            <span className="text-sm font-semibold text-gray-300 group-hover:text-white">Open App Data</span>
                                            <span className="text-xs text-gray-500">Database & Assets</span>
                                        </button>
                                    </div>

                                    <div className="border-t border-gray-800 pt-6 mt-2">
                                        <button
                                            onClick={handleReset}
                                            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 hover:bg-red-900/30 hover:border-red-800 hover:text-red-200 rounded text-sm transition-all text-gray-400"
                                        >
                                            Reset All Settings to Defaults
                                        </button>
                                    </div>
                                </div>
                            </Tabs.Content>
                        </div>
                    </Tabs.Root>

                    {/* Footer */}
                    <div className="p-6 border-t border-gray-800 bg-gray-900 flex justify-end gap-3">
                        <button
                            onClick={() => onOpenChange(false)}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors text-white"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors text-white"
                        >
                            {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>

                    <ModelDownloader open={downloaderOpen} onOpenChange={setDownloaderOpen} />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

const TabTrigger: React.FC<{ value: string, children: React.ReactNode }> = ({ value, children }) => (
    <Tabs.Trigger
        value={value}
        className="px-1 py-3 text-sm font-medium text-gray-400 hover:text-gray-200 border-b-2 border-transparent data-[state=active]:text-blue-400 data-[state=active]:border-blue-500 transition-all outline-none"
    >
        {children}
    </Tabs.Trigger>
);

const SettingSlider: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (val: number) => void;
    tooltip: string;
}> = ({ label, value, min, max, step, onChange, tooltip }) => {
    return (
        <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-300">{label}</label>
                    <InfoTooltip text={tooltip} />
                </div>
                <span className="text-xs text-blue-400 font-mono bg-blue-900/30 px-2 py-0.5 rounded border border-blue-500/20">{value.toFixed(2)}</span>
            </div>

            <Slider.Root
                className="relative flex items-center select-none touch-none w-full h-5"
                value={[value]}
                max={max}
                min={min}
                step={step}
                onValueChange={(vals) => onChange(vals[0])}
            >
                <Slider.Track className="bg-gray-700 relative grow rounded-full h-[3px]">
                    <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                </Slider.Track>
                <Slider.Thumb
                    className="block w-5 h-5 bg-white shadow-lg rounded-[10px] hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-transform hover:scale-110"
                    aria-label={label}
                />
            </Slider.Root>
        </div>
    )
}

const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
    <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
            <Tooltip.Trigger asChild>
                <button className="text-gray-500 hover:text-blue-400 cursor-help">
                    <InfoCircledIcon />
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content
                    className="select-none rounded bg-gray-800 px-3 py-2 text-xs leading-none text-white shadow-md border border-gray-700 max-w-xs z-[60]"
                    sideOffset={5}
                >
                    {text}
                    <Tooltip.Arrow className="fill-gray-800" />
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    </Tooltip.Provider>
);

export default SettingsModal;
