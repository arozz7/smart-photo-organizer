import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Slider from '@radix-ui/react-slider';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Cross2Icon, InfoCircledIcon } from '@radix-ui/react-icons';

interface SettingsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface AISettings {
    faceDetectionThreshold: number;
    faceBlurThreshold: number;
    vlmTemperature: number;
    vlmMaxTokens: number;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onOpenChange }) => {
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState<AISettings>({
        faceDetectionThreshold: 0.6,
        faceBlurThreshold: 20.0,
        vlmTemperature: 0.2,
        vlmMaxTokens: 100
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
            alert("Failed to save settings");
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key: keyof AISettings, value: number) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleReset = () => {
        if (confirm("Reset all AI settings to default values?")) {
            setSettings({
                faceDetectionThreshold: 0.6,
                faceBlurThreshold: 20.0,
                vlmTemperature: 0.2,
                vlmMaxTokens: 100
            });
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-gray-900 border border-gray-700 p-6 rounded-lg shadow-xl z-50">
                    <Dialog.Title className="text-xl font-bold mb-4 text-white">Settings</Dialog.Title>

                    <div className="space-y-6">
                        <h3 className="text-lg font-semibold text-blue-400 border-b border-gray-700 pb-2">AI Configuration</h3>

                        {/* Face Detection Threshold */}
                        <SettingSlider
                            label="Face Detection Confidence"
                            value={settings.faceDetectionThreshold}
                            min={0.1} max={0.99} step={0.01}
                            onChange={(v) => handleChange('faceDetectionThreshold', v)}
                            tooltip="Minimum confidence score (0.0 - 1.0) to detect a face. Higher values reduce false positives (like trees seeing valid faces) but might miss difficult faces."
                        />

                        {/* Face Blur Threshold */}
                        <SettingSlider
                            label="Face Blur Threshold"
                            value={settings.faceBlurThreshold}
                            min={0} max={100} step={1}
                            onChange={(v) => handleChange('faceBlurThreshold', v)}
                            tooltip="Minimum sharpness score. Faces below this score will be prevented from being captured entirely (Prevent mode). Typical blurry photos are < 20. Sharp photos are > 100."
                        />

                        {/* VLM Temperature */}
                        <SettingSlider
                            label="Tagging Creativity (Temperature)"
                            value={settings.vlmTemperature}
                            min={0.0} max={1.5} step={0.1}
                            onChange={(v) => handleChange('vlmTemperature', v)}
                            tooltip="Controls randomness in tag generation. Lower (0.1) is more factual/deterministic. Higher (0.8+) is more creative but can hallucinate."
                        />

                        {/* VLM Tokens */}
                        <div className="flex flex-col space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-gray-300">Max Tagging Tokens</label>
                                    <InfoTooltip text="Maximum length of the generated description/tags. 100 is usually enough." />
                                </div>
                                <span className="text-xs text-blue-400 font-mono">{settings.vlmMaxTokens}</span>
                            </div>
                            <input
                                type="number"
                                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm w-full focus:outline-none focus:border-blue-500"
                                value={settings.vlmMaxTokens}
                                onChange={(e) => handleChange('vlmMaxTokens', parseInt(e.target.value))}
                            />
                        </div>

                    </div>

                    <div className="mt-8 flex gap-3">
                        <button
                            onClick={handleReset}
                            className="px-4 py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded text-sm transition-colors text-gray-300 mr-auto"
                        >
                            Defaults
                        </button>
                        <button
                            onClick={() => onOpenChange(false)}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors text-white"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors text-white"
                        >
                            {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>

                    <Dialog.Close asChild>
                        <button
                            className="absolute top-4 right-4 text-gray-400 hover:text-white"
                            aria-label="Close"
                        >
                            <Cross2Icon />
                        </button>
                    </Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

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
                <span className="text-xs text-blue-400 font-mono">{value.toFixed(2)}</span>
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
