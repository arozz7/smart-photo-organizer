import SettingsSection from './SettingsSection';
import type { EraConfig } from '../../hooks/useAiSettings';

interface EraGenerationSectionProps {
    eraConfig: EraConfig
    onMergeThresholdChange: (value: number) => void
    onMinFacesChange: (value: number) => void
}

/** Era Generation: how similar eras must be to merge and how many confirmed faces justify an era. */
export default function EraGenerationSection({ eraConfig, onMergeThresholdChange, onMinFacesChange }: EraGenerationSectionProps) {
    return (
        <SettingsSection title="Era Generation">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-6">
                <div>
                    <h4 className="font-medium text-white mb-1">Merge Similarity Threshold</h4>
                    <p className="text-sm text-gray-400 mb-3">
                        How similar two eras must be to merge. (0.6 = Strict, 1.3+ = Force Merge).
                    </p>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.05"
                            value={eraConfig.mergeThreshold}
                            onChange={(e) => onMergeThresholdChange(parseFloat(e.target.value))}
                            className="w-full accent-indigo-500"
                        />
                        <span className="text-sm font-mono text-indigo-400 w-12 text-right">{eraConfig.mergeThreshold.toFixed(2)}</span>
                    </div>
                </div>

                <div>
                    <h4 className="font-medium text-white mb-1">Minimum Faces per Era</h4>
                    <p className="text-sm text-gray-400 mb-3">
                        Minimum number of confirmed faces required to justify creating a separate Era.
                    </p>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min="10"
                            max="500"
                            step="10"
                            value={eraConfig.minFaces}
                            onChange={(e) => onMinFacesChange(parseInt(e.target.value))}
                            className="w-full accent-indigo-500"
                        />
                        <span className="text-sm font-mono text-indigo-400 w-12 text-right">{eraConfig.minFaces}</span>
                    </div>
                </div>
            </div>
        </SettingsSection>
    )
}
