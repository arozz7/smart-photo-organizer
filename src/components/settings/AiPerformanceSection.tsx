import { useState } from 'react'
import SettingsModal from '../SettingsModal';
import SettingsSection from './SettingsSection';
import type { AiProfile, CaptionTiming } from '../../hooks/useAiSettings';

interface AiPerformanceSectionProps {
    aiProfile: AiProfile
    vlmEnabled: boolean
    captionTiming: CaptionTiming
    backgroundDuringScan: boolean
    onProfileChange: (profile: AiProfile) => void
    onVlmToggle: () => void
    onCaptionTimingChange: (timing: CaptionTiming) => void
    onBackgroundDuringScanChange: (enabled: boolean) => void
}

/** AI Performance Profile: model profile, Smart Tags (VLM), background tasks and the advanced model configuration dialog. */
export default function AiPerformanceSection({ aiProfile, vlmEnabled, captionTiming, backgroundDuringScan, onProfileChange, onVlmToggle, onCaptionTimingChange, onBackgroundDuringScanChange }: AiPerformanceSectionProps) {
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    return (
        <>
            <SettingsModal
                open={showSettingsModal}
                onOpenChange={setShowSettingsModal}
            />

            <SettingsSection title="AI Performance Profile">
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                    <div className="flex justify-between items-center gap-4 flex-wrap">
                        <div>
                            <h4 className="font-medium text-white">Model Selection</h4>
                            <p className="text-sm text-gray-400 mt-1">
                                Choose the balance between speed and accuracy.
                            </p>
                        </div>
                        <select
                            aria-label="AI model profile"
                            className="bg-gray-700 text-white text-sm px-3 py-2 rounded focus:ring-1 focus:ring-indigo-500 outline-none border border-gray-600"
                            value={aiProfile}
                            onChange={(e) => onProfileChange(e.target.value as AiProfile)}
                        >
                            <option value="balanced">Balanced (Faster)</option>
                            <option value="high">High Accuracy (Requires ~2GB+ VRAM/RAM)</option>
                        </select>
                    </div>
                    <div className="text-xs text-gray-500 bg-black/20 p-3 rounded">
                        <ul className="list-disc list-inside space-y-1">
                            <li><strong>Balanced:</strong> Uses standard models. Good for most users. Fast scanning.</li>
                            <li><strong>High Accuracy:</strong> Uses <code>clip-vit-large</code> for superior tagging. Scanning will be slower.</li>
                        </ul>
                    </div>

                    {/* Smart Tags Toggle (Added for visibility) */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-700">
                        <div className="flex flex-col gap-1">
                            <h4 className="font-medium text-white">Smart Tags (VLM)</h4>
                            <p className="text-sm text-gray-400">
                                Use AI (SmolVLM) to describe photos and generate search tags.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${vlmEnabled ? 'text-green-500' : 'text-gray-500'}`}>
                                {vlmEnabled ? 'ENABLED' : 'DISABLED'}
                            </span>
                            <button
                                onClick={onVlmToggle}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${vlmEnabled ? 'bg-indigo-600' : 'bg-gray-700'
                                    }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${vlmEnabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        </div>
                    </div>

                    {vlmEnabled && (
                        <div className="flex justify-between items-center gap-4 flex-wrap">
                            <div>
                                <h4 className="font-medium text-white">Descriptions and tags</h4>
                                <p className="text-sm text-gray-400 mt-1">
                                    In the background they follow the face scan when nothing else is working, so scanning is about four times faster. While scanning, each photo waits for its description.
                                </p>
                            </div>
                            <select
                                aria-label="When to make descriptions and tags"
                                className="bg-gray-700 text-white text-sm px-3 py-2 rounded focus:ring-1 focus:ring-indigo-500 outline-none border border-gray-600"
                                value={captionTiming}
                                onChange={(e) => onCaptionTimingChange(e.target.value as CaptionTiming)}
                            >
                                <option value="background">In the background (faster scans)</option>
                                <option value="scan">While scanning</option>
                            </select>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-4 pt-4 border-t border-gray-700">
                        <div>
                            <h4 className="font-medium text-white">Background tasks while scanning</h4>
                            <p className="text-sm text-gray-400 mt-1">
                                Face checks, grouping and descriptions normally wait until the face scan is done, so scanning runs at full speed. Turn this on to run them at the same time (the scan gets slower).
                            </p>
                        </div>
                        <input
                            type="checkbox"
                            aria-label="Run background tasks while scanning"
                            className="h-5 w-5 shrink-0 accent-indigo-600"
                            checked={backgroundDuringScan}
                            onChange={(e) => onBackgroundDuringScanChange(e.target.checked)}
                        />
                    </div>

                    {/* Advanced Configuration (Moved from Header) */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-700">
                        <div>
                            <h4 className="font-medium text-white">Advanced Configuration</h4>
                            <p className="text-sm text-gray-400">
                                Manage downloaded models and fine-tune detection thresholds.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowSettingsModal(true)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors border border-blue-500/50"
                        >
                            Configure Models
                        </button>
                    </div>
                </div>
            </SettingsSection>
        </>
    )
}
