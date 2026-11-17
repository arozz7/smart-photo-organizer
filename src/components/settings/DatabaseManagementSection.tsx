import { useState } from 'react'
import { useAI } from '../../context/AIContext';
import { FaceDataHealthCard } from '../FaceDataHealthCard';
import SettingsSection from './SettingsSection';
import FactoryResetModal from './FactoryResetModal';
import { useDatabaseMaintenance } from '../../hooks/useDatabaseMaintenance';

/** Database Management: tag cleanup, face maintenance, factory reset, blur scores and face data health. */
export default function DatabaseManagementSection() {
    const { calculatingBlur, blurProgress, calculateBlurScores } = useAI();
    const { message, clearing, clearAiTags, cleanupTags, removeDuplicateFaces } = useDatabaseMaintenance();
    const [showResetConfirm, setShowResetConfirm] = useState(false)

    return (
        <>
            <SettingsSection title="Database Management">
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                    <div className="flex justify-between items-center gap-4 flex-wrap">
                        <div>
                            <h4 className="font-medium text-white">Clear AI Tags</h4>
                            <p className="text-sm text-gray-400 mt-1">
                                Remove all AI-generated tags.
                            </p>
                        </div>
                        <button
                            onClick={clearAiTags}
                            disabled={clearing}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${clearing
                                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                                : 'bg-red-600 hover:bg-red-700 text-white'
                                }`}
                        >
                            {clearing ? 'Clearing...' : 'Clear Tags'}
                        </button>
                    </div>

                    <div className="flex justify-between items-center gap-4 flex-wrap border-t border-gray-700 pt-4 mt-4">
                        <div>
                            <h4 className="font-medium text-white">Cleanup & Optimize Tags</h4>
                            <p className="text-sm text-gray-400 mt-1">
                                Split multi-word tags, enforce lowercase, and remove duplicates.
                                <br />
                                <span className="text-orange-400 font-semibold text-xs">⚠️ Destructive: Modifies existing tag database.</span>
                            </p>
                        </div>
                        <button
                            onClick={cleanupTags}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors border border-gray-600"
                        >
                            Cleanup Tags
                        </button>
                    </div>

                    {message && (
                        <div className={`p-3 rounded text-sm ${message.includes('Success') ? 'bg-green-900/50 text-green-200' : 'bg-red-900/50 text-red-200'}`}>
                            {message}
                        </div>
                    )}

                    <div className="flex justify-between items-center border-t border-gray-700 pt-4 mt-4 flex-wrap gap-4">
                        <div>
                            <h4 className="font-medium text-white">Maintenance</h4>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <button
                                onClick={removeDuplicateFaces}
                                className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                            >
                                Deduplicate Faces
                            </button>
                            <button
                                onClick={() => setShowResetConfirm(true)}
                                className="px-4 py-2 rounded-md text-sm font-medium bg-red-900/80 hover:bg-red-800 text-red-100 border border-red-700"
                            >
                                Factory Reset
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-gray-700 pt-4 mt-4 flex-wrap gap-4">
                        <div>
                            <h4 className="font-medium text-white">Blur Scores</h4>
                            <p className="text-sm text-gray-400 mt-1 max-w-xs">
                                Calculate blur scores for existing faces.
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            {calculatingBlur && (
                                <span className="text-sm text-blue-400 font-mono">
                                    {blurProgress.current} / {blurProgress.total}
                                </span>
                            )}
                            <button
                                onClick={calculateBlurScores}
                                disabled={calculatingBlur}
                                className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 disabled:opacity-50"
                            >
                                {calculatingBlur ? 'Calculated...' : 'Calculate Scores'}
                            </button>
                        </div>
                    </div>

                    {/* Unified Face Data Health (replaces FaceDataUpgradeManager + AgeBackfillCard) */}
                    <div className="border-t border-gray-700 pt-4 mt-4">
                        <FaceDataHealthCard />
                    </div>
                </div>
            </SettingsSection>

            {showResetConfirm && <FactoryResetModal onClose={() => setShowResetConfirm(false)} />}
        </>
    )
}
