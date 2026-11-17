import { useState, useEffect } from 'react'
import ScanWarningsModal from '../components/ScanWarningsModal';
import { useAI } from '../context/AIContext';
import { useAlert } from '../context/AlertContext';
import { FaceDataHealthCard } from '../components/FaceDataHealthCard';
import SendToSettingsCard from '../components/SendToSettingsCard';

import SettingsSection from '../components/settings/SettingsSection';
import PreviewManager from '../components/settings/PreviewManager';
import LibraryStorageSection from '../components/settings/LibraryStorageSection';
import SmartAssignmentSection from '../components/settings/SmartAssignmentSection';
import AiPerformanceSection from '../components/settings/AiPerformanceSection';
import PersonIdentificationSection from '../components/settings/PersonIdentificationSection';
import EraGenerationSection from '../components/settings/EraGenerationSection';
import { useAiSettings } from '../hooks/useAiSettings';

export default function Settings() {
    const [clearing, setClearing] = useState(false)
    const [message, setMessage] = useState('')
    const [showWarningsModal, setShowWarningsModal] = useState(false);
    const [prsExecutablePath, setPrsExecutablePath] = useState('');
    const { calculatingBlur, blurProgress, calculateBlurScores } = useAI();
    const { showAlert, showConfirm } = useAlert();
    const ai = useAiSettings();

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('settings:get').then((cfg: any) => {
            if (cfg?.prsExecutablePath) setPrsExecutablePath(cfg.prsExecutablePath);
        });
    }, [])

    const handleClearAITags = async () => {
        showConfirm({
            title: 'Clear AI Tags',
            description: 'Are you sure you want to delete ALL AI-generated tags? This cannot be undone.',
            confirmLabel: 'Delete All Tags',
            variant: 'danger',
            onConfirm: async () => {
                setClearing(true)
                try {
                    // @ts-ignore
                    const result = await window.ipcRenderer.invoke('db:clearAITags')
                    if (result.success) {
                        setMessage('Successfully cleared all AI tags.')
                    } else {
                        setMessage('Failed to clear tags: ' + result.error)
                    }
                } catch (error) {
                    setMessage('Error invoking command: ' + error)
                } finally {
                    setClearing(false)
                }
            }
        });
    }

    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [resetInput, setResetInput] = useState('')

    const handleFactoryReset = async () => {
        if (resetInput !== 'RESET') return

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:factoryReset')
            if (res.success) {
                showAlert({
                    title: 'Reset Complete',
                    description: 'Factory reset complete. Application will now reload.',
                    onConfirm: () => window.location.reload()
                });
            } else {
                showAlert({
                    title: 'Reset Failed',
                    description: res.error,
                    variant: 'danger'
                });
            }
        } catch (e) {
            showAlert({
                title: 'Error',
                description: String(e),
                variant: 'danger'
            });
        }
    }

    return (
        <div className="p-8 h-full overflow-y-auto bg-gray-900 text-gray-100 relative">
            <h2 className="text-3xl font-bold mb-8 text-white flex items-center justify-between">
                <span>Settings</span>
            </h2>

            <ScanWarningsModal
                isOpen={showWarningsModal}
                onClose={() => setShowWarningsModal(false)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl w-full">
                {/* Left Column */}
                <div className="space-y-8">
                    <LibraryStorageSection onMoveStarted={() => setClearing(true)} />

                    <AiPerformanceSection
                        aiProfile={ai.aiProfile}
                        vlmEnabled={ai.vlmEnabled}
                        onProfileChange={ai.changeProfile}
                        onVlmToggle={ai.toggleVlm}
                    />

                    <PersonIdentificationSection />

                    <EraGenerationSection
                        eraConfig={ai.eraConfig}
                        onMergeThresholdChange={ai.changeEraMergeThreshold}
                        onMinFacesChange={ai.changeEraMinFaces}
                    />

                    <SmartAssignmentSection />
                </div>

                {/* Right Column */}
                <div className="space-y-8">
                    {/* Preview Cache Management */}
                    <SettingsSection title="Preview Cache">
                        <PreviewManager />
                    </SettingsSection>

                    {/* Database Management Section */}
                    <section className="space-y-4">
                        <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Database Management</h3>

                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                            <div className="flex justify-between items-center gap-4 flex-wrap">
                                <div>
                                    <h4 className="font-medium text-white">Clear AI Tags</h4>
                                    <p className="text-sm text-gray-400 mt-1">
                                        Remove all AI-generated tags.
                                    </p>
                                </div>
                                <button
                                    onClick={handleClearAITags}
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
                                    onClick={async () => {
                                        showConfirm({
                                            title: 'Cleanup Tags',
                                            description: `This will normalize ALL existing tags:\n\n1. Convert to lowercase\n2. Split phrases into single words\n3. Remove punctuation\n4. Merge duplicates\n\nThis cannot be undone.`,
                                            confirmLabel: 'Run Cleanup',
                                            variant: 'danger',
                                            onConfirm: async () => {
                                                try {
                                                    // @ts-ignore
                                                    const res = await window.ipcRenderer.invoke('db:cleanupTags');
                                                    if (res.success) {
                                                        showAlert({
                                                            title: 'Cleanup Complete',
                                                            description: `Cleanup finished.\nTags Deleted: ${res.deletedCount}\nLinks Updated: ${res.mergedCount}`
                                                        });
                                                    } else {
                                                        showAlert({
                                                            title: 'Cleanup Failed',
                                                            description: res.error,
                                                            variant: 'danger'
                                                        });
                                                    }
                                                } catch (e) {
                                                    showAlert({
                                                        title: 'Error',
                                                        description: String(e),
                                                        variant: 'danger'
                                                    });
                                                }
                                            }
                                        });
                                    }}
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
                                        onClick={async () => {
                                            showConfirm({
                                                title: 'Deduplicate Faces',
                                                description: 'Find and remove duplicate faces? This will keep named faces and remove duplicates.',
                                                confirmLabel: 'Start Cleanup',
                                                onConfirm: async () => {
                                                    try {
                                                        // @ts-ignore
                                                        const res = await window.ipcRenderer.invoke('db:removeDuplicateFaces')
                                                        showAlert({
                                                            title: 'Cleanup Complete',
                                                            description: `Removed ${res.removedCount} duplicate faces.`
                                                        });
                                                    } catch (e) {
                                                        showAlert({
                                                            title: 'Cleanup Failed',
                                                            description: String(e),
                                                            variant: 'danger'
                                                        });
                                                    }
                                                }
                                            });
                                        }}
                                        className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                                    >
                                        Deduplicate Faces
                                    </button>
                                    <button
                                        onClick={() => {
                                            setResetInput('')
                                            setShowResetConfirm(true)
                                        }}
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
                    </section>
                </div>
            </div>

            {/* Integrations */}
            <section className="space-y-4 pt-8">
                <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Integrations</h3>
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
            </section>

            {/* Scan Errors / Warnings */}
            <section className="space-y-4 pt-8">
                <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Health & Logs</h3>
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 flex justify-between items-center">
                    <div>
                        <h4 className="font-medium text-white">Scan Warnings</h4>
                        <p className="text-sm text-gray-400 mt-1">
                            View corrupt files or errors encountered during scanning.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowWarningsModal(true)}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                    >
                        View Warnings
                    </button>
                </div>
            </section>


            {/* Factory Reset Modal */}
            {
                showResetConfirm && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
                        <div className="bg-gray-800 p-8 rounded-lg border border-red-500/50 max-w-md w-full shadow-2xl">
                            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                <span className="text-red-500">⚠️</span> Factory Reset
                            </h3>
                            <div className="space-y-4">
                                <p className="text-gray-300">
                                    This will <strong>permanently delete</strong> all data from your library database, including:
                                </p>
                                <ul className="list-disc list-inside text-gray-400 text-sm pl-2">
                                    <li>All photo index data</li>
                                    <li>All generated tags</li>
                                    <li>All detected faces and people names</li>
                                    <li>All generated thumbnails</li>
                                </ul>
                                <p className="text-red-400 text-sm font-semibold">
                                    This action cannot be undone.
                                </p>

                                <div className="pt-2">
                                    <label className="block text-gray-400 text-xs mb-1">To confirm, type <span className="font-mono font-bold text-white">RESET</span> below:</label>
                                    <input
                                        type="text"
                                        className="w-full bg-gray-900 border border-red-900 rounded px-3 py-2 text-white focus:border-red-500 outline-none"
                                        placeholder="Type RESET"
                                        value={resetInput}
                                        onChange={e => setResetInput(e.target.value)}
                                    />
                                </div>

                                <div className="flex justify-end gap-3 pt-2">
                                    <button
                                        onClick={() => setShowResetConfirm(false)}
                                        className="px-4 py-2 rounded text-gray-300 hover:bg-gray-700"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleFactoryReset}
                                        disabled={resetInput !== 'RESET'}
                                        className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                                    >
                                        Confirm Reset
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

        </div>
    )
}
