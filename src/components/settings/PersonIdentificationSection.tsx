import { usePeople } from '../../context/PeopleContext';
import SettingsSection from './SettingsSection';
import SettingsToggle from './SettingsToggle';

/** Person Identification: AI name suggestions and how strict face grouping is. */
export default function PersonIdentificationSection() {
    const { smartIgnoreSettings, updateSmartIgnoreSettings } = usePeople();

    return (
        <SettingsSection title="Person Identification">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                <SettingsToggle
                    label="AI Name Suggestions"
                    description="Suggest names for unknown faces based on visual similarity."
                    value={smartIgnoreSettings?.enableAiSuggestions ?? true}
                    onChange={(val) => updateSmartIgnoreSettings({ enableAiSuggestions: val })}
                />

                <div className="pt-4 border-t border-gray-700">
                    <label className="block text-sm font-medium text-white mb-1">
                        Suggestion Strength: <span className="text-indigo-400">{(smartIgnoreSettings?.aiSuggestionThreshold ?? 0.6).toFixed(2)}</span>
                    </label>
                    <p className="text-xs text-gray-400 mb-3">
                        Higher values require stronger matches for suggestions. Lower values suggest more liberally.
                    </p>
                    <input
                        type="range"
                        min="0.3"
                        max="0.85"
                        step="0.01"
                        value={smartIgnoreSettings?.aiSuggestionThreshold ?? 0.6}
                        onChange={(e) => updateSmartIgnoreSettings({ aiSuggestionThreshold: parseFloat(e.target.value) })}
                        className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Liberal (0.3)</span>
                        <span>Strict (0.85)</span>
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-700">
                    <label className="block text-sm font-medium text-white mb-1">
                        Ungroupable Distance: <span className="text-indigo-400">{(smartIgnoreSettings?.ungroupableDistanceThreshold ?? 1.0).toFixed(2)}</span>
                    </label>
                    <p className="text-xs text-gray-400 mb-3">
                        Faces farther than this from any named person are shown separately for quick ignore. Higher = more aggressive filtering.
                    </p>
                    <input
                        type="range"
                        min="0.7"
                        max="1.3"
                        step="0.05"
                        value={smartIgnoreSettings?.ungroupableDistanceThreshold ?? 1.0}
                        onChange={(e) => updateSmartIgnoreSettings({ ungroupableDistanceThreshold: parseFloat(e.target.value) })}
                        className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Conservative (0.7)</span>
                        <span>Aggressive (1.3)</span>
                    </div>
                </div>
            </div>
        </SettingsSection>
    )
}
