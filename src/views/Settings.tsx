import { useState, useEffect } from 'react'
import SettingsModal from '../components/SettingsModal';
import ScanWarningsModal from '../components/ScanWarningsModal';
import { useAI } from '../context/AIContext';
import { useAlert } from '../context/AlertContext';
import { usePoseBackfill } from '../hooks/usePoseBackfill';
import { usePeople } from '../context/PeopleContext';

function SettingsToggle({ label, description, value, onChange }: { label: string, description: string, value: boolean, onChange: (val: boolean) => void }) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <h4 className="font-medium text-white">{label}</h4>
                <p className="text-sm text-gray-400 max-w-sm">{description}</p>
            </div>
            <button
                onClick={() => onChange(!value)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${value ? 'bg-indigo-600' : 'bg-gray-700'}`}
            >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
        </div>
    );
}

function PreviewManager() {
    const [stats, setStats] = useState<{ count: number, size: number } | null>(null)
    const [loading, setLoading] = useState(false)
    const { showAlert, showConfirm } = useAlert()

    const loadStats = async () => {
        // @ts-ignore
        const res = await window.ipcRenderer.invoke('settings:getPreviewStats')
        if (res.success) {
            setStats({ count: res.count, size: res.size })
        }
    }

    useEffect(() => {
        loadStats()
    }, [])

    const handleCleanup = async (days: number) => {
        showConfirm({
            title: 'Clear Preview Cache',
            description: `Delete previews older than ${days} days?`,
            confirmLabel: 'Clear Cache',
            variant: days === 0 ? 'danger' : 'primary',
            onConfirm: async () => {
                setLoading(true)
                try {
                    // @ts-ignore
                    const res = await window.ipcRenderer.invoke('settings:cleanupPreviews', { days })
                    if (res.success) {
                        showAlert({
                            title: 'Cleanup Complete',
                            description: `Deleted: ${res.deletedCount} files\nFreed: ${(res.deletedSize / 1024 / 1024).toFixed(2)} MB`
                        });
                        loadStats()
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
                } finally {
                    setLoading(false)
                }
            }
        });
    }

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
            <div>
                <h4 className="font-medium text-white">Cache Statistics</h4>
                {stats ? (
                    <div className="text-sm text-gray-400 mt-1 flex gap-6">
                        <span><strong>Files:</strong> {stats.count}</span>
                        <span><strong>Size:</strong> {formatSize(stats.size)}</span>
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">Loading stats...</p>
                )}
            </div>

            <div className="flex gap-3 flex-wrap">
                <button
                    disabled={loading}
                    onClick={() => handleCleanup(30)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                >
                    Clear {'\u003e'} 30 Days
                </button>
                <button
                    disabled={loading}
                    onClick={() => handleCleanup(7)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                >
                    Clear {'\u003e'} 7 Days
                </button>
                <button
                    disabled={loading}
                    onClick={() => handleCleanup(0)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-800/50 transition-colors"
                >
                    Clear All
                </button>
            </div>
            <p className="text-xs text-gray-500">
                Clearing previews will not delete original photos. Previews will be regenerated as needed.
            </p>
        </div>
    )
}

function FaceDataUpgradeManager() {
    const { status, isRunning, isPaused, startBackfill, pauseBackfill, resumeBackfill, stopBackfill } = usePoseBackfill();

    if (!status || status.needsBackfill === 0) {
        return null;
    }

    return (
        <div className="flex justify-between items-center border-t border-gray-700 pt-4 mt-4 flex-wrap gap-4">
            <div>
                <h4 className="font-medium text-white">Face Data Upgrade</h4>
                <p className="text-sm text-gray-400 mt-1 max-w-xs">
                    Update existing faces with pose and quality data.
                </p>
                <div className="text-xs text-gray-500 mt-1 font-mono">
                    {status.percent}% ({status.completed} / {status.total})
                </div>
            </div>
            <div className="flex items-center gap-3">
                {isRunning && (
                    <span className="text-xs text-blue-400 animate-pulse">
                        {isPaused ? 'PAUSED' : 'PROCESSING...'}
                    </span>
                )}

                {!isRunning ? (
                    <button
                        onClick={() => startBackfill()}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                    >
                        Start Upgrade
                    </button>
                ) : (
                    <div className="flex gap-2">
                        <button
                            onClick={isPaused ? resumeBackfill : pauseBackfill}
                            className="px-3 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                        >
                            {isPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                            onClick={stopBackfill}
                            className="px-3 py-2 rounded-md text-sm font-medium bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-800/50"
                        >
                            Stop
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function Settings() {
    const [clearing, setClearing] = useState(false)
    const [message, setMessage] = useState('')
    const [libraryPath, setLibraryPath] = useState(localStorage.getItem('libraryPath') || '')
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showWarningsModal, setShowWarningsModal] = useState(false);
    const { calculatingBlur, blurProgress, calculateBlurScores } = useAI();
    const { showAlert, showConfirm } = useAlert();
    const { smartIgnoreSettings, updateSmartIgnoreSettings } = usePeople();

    const [aiProfile, setAiProfile] = useState<'balanced' | 'high'>('balanced');
    const [vlmEnabled, setVlmEnabled] = useState(false);
    const [eraConfig, setEraConfig] = useState<{ minFaces: number, mergeThreshold: number }>({ minFaces: 50, mergeThreshold: 0.75 });

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('settings:getLibraryPath').then(path => {
            setLibraryPath(path)
            localStorage.setItem('libraryPath', path)
        });

        // @ts-ignore
        window.ipcRenderer.invoke('ai:getSettings').then((settings: any) => {
            if (settings) {
                if (settings.aiProfile) setAiProfile(settings.aiProfile);
                if (settings.vlmEnabled !== undefined) setVlmEnabled(settings.vlmEnabled);
                setEraConfig({
                    minFaces: settings.minFacesForEra ?? 50,
                    mergeThreshold: settings.eraMergeThreshold ?? 0.75
                });
            }
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

            <SettingsModal
                open={showSettingsModal}
                onOpenChange={setShowSettingsModal}
            />

            <ScanWarningsModal
                isOpen={showWarningsModal}
                onClose={() => setShowWarningsModal(false)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl w-full">
                {/* Left Column */}
                <div className="space-y-8">
                    {/* Library Storage Config */}
                    <section className="space-y-4">
                        <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Library Storage</h3>

                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                            <div>
                                <h4 className="font-medium text-white">Current Location</h4>
                                <p className="text-sm text-gray-400 mt-1 mb-2 break-all bg-black/30 p-2 rounded font-mono">
                                    {libraryPath || 'Loading...'}
                                </p>
                                <p className="text-xs text-gray-500 mb-4">
                                    This folder contains your database, generated previews, and AI indices.
                                </p>
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={async () => {
                                        // @ts-ignore
                                        const path = await window.ipcRenderer.invoke('dialog:openDirectory')
                                        if (path) {
                                            showConfirm({
                                                title: 'Move Library',
                                                description: `Move library to:\n${path}\n\nThe application will restart automatically.`,
                                                confirmLabel: 'Move & Restart',
                                                onConfirm: async () => {
                                                    // @ts-ignore
                                                    const res = await window.ipcRenderer.invoke('settings:moveLibrary', path)
                                                    if (!res.success) {
                                                        showAlert({
                                                            title: 'Move Failed',
                                                            description: res.error,
                                                            variant: 'danger'
                                                        });
                                                    }
                                                }
                                            });
                                        }
                                    }}
                                    className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                                >
                                    Move Library
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* AI Performance Profile */}
                    <section className="space-y-4">
                        <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">AI Performance Profile</h3>

                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                            <div className="flex justify-between items-center gap-4 flex-wrap">
                                <div>
                                    <h4 className="font-medium text-white">Model Selection</h4>
                                    <p className="text-sm text-gray-400 mt-1">
                                        Choose the balance between speed and accuracy.
                                    </p>
                                </div>
                                <select
                                    className="bg-gray-700 text-white text-sm px-3 py-2 rounded focus:ring-1 focus:ring-indigo-500 outline-none border border-gray-600"
                                    value={aiProfile}
                                    onChange={async (e) => {
                                        const newProfile = e.target.value as 'balanced' | 'high';
                                        setAiProfile(newProfile);

                                        // Fetch current settings to merge
                                        // @ts-ignore
                                        const current = await window.ipcRenderer.invoke('ai:getSettings');
                                        const updated = { ...current, aiProfile: newProfile };

                                        // @ts-ignore
                                        await window.ipcRenderer.invoke('ai:saveSettings', updated);

                                        showConfirm({
                                            title: 'Reload Required',
                                            description: 'Changing the AI profile requires a reload to load the new models. Reload now?',
                                            confirmLabel: 'Reload Now',
                                            onConfirm: () => window.location.reload()
                                        });
                                    }}
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
                                        onClick={async () => {
                                            const newState = !vlmEnabled;
                                            setVlmEnabled(newState);
                                            // @ts-ignore
                                            const current = await window.ipcRenderer.invoke('ai:getSettings');
                                            const updated = { ...current, vlmEnabled: newState };
                                            // @ts-ignore
                                            await window.ipcRenderer.invoke('ai:saveSettings', updated);

                                            showConfirm({
                                                title: 'Reload Required',
                                                description: `You have ${newState ? 'Enabled' : 'Disabled'} Smart Tags. Please reload the application to apply this change.`,
                                                confirmLabel: 'Reload Now',
                                                onConfirm: () => window.location.reload()
                                            });
                                        }}
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
                    </section>

                    {/* Person Identification Settings */}
                    <section className="space-y-4">
                        <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Person Identification</h3>

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
                        </div>
                    </section>

                    {/* Era Generation Settings */}
                    <section className="space-y-4">
                        <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Era Generation</h3>

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
                                        onChange={async (e) => {
                                            const val = parseFloat(e.target.value);
                                            setEraConfig(prev => ({ ...prev, mergeThreshold: val }));
                                            // @ts-ignore
                                            const current = await window.ipcRenderer.invoke('ai:getSettings');
                                            // @ts-ignore
                                            await window.ipcRenderer.invoke('ai:saveSettings', { ...current, eraMergeThreshold: val });
                                        }}
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
                                        onChange={async (e) => {
                                            const val = parseInt(e.target.value);
                                            setEraConfig(prev => ({ ...prev, minFaces: val }));
                                            // @ts-ignore
                                            const current = await window.ipcRenderer.invoke('ai:getSettings');
                                            // @ts-ignore
                                            await window.ipcRenderer.invoke('ai:saveSettings', { ...current, minFacesForEra: val });
                                        }}
                                        className="w-full accent-indigo-500"
                                    />
                                    <span className="text-sm font-mono text-indigo-400 w-12 text-right">{eraConfig.minFaces}</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Right Column */}
                <div className="space-y-8">
                    {/* Preview Cache Management */}
                    <section className="space-y-4">
                        <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Preview Cache</h3>
                        <PreviewManager />
                    </section>

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

                            <FaceDataUpgradeManager />
                        </div>
                    </section>
                </div>
            </div>

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
