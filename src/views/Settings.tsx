import { useState, useEffect } from 'react'
import SettingsModal from '../components/SettingsModal';
import { useAI } from '../context/AIContext';

function PreviewManager() {
    const [stats, setStats] = useState<{ count: number, size: number } | null>(null)
    const [loading, setLoading] = useState(false)

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
        if (!confirm(`Delete previews older than ${days} days?`)) return
        setLoading(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('settings:cleanupPreviews', { days })
            if (res.success) {
                alert(`Cleanup complete.\nDeleted: ${res.deletedCount} files\nFreed: ${(res.deletedSize / 1024 / 1024).toFixed(2)} MB`)
                loadStats()
            } else {
                alert("Cleanup failed: " + res.error)
            }
        } catch (e) {
            alert("Error: " + e)
        } finally {
            setLoading(false)
        }
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
                    Clear &gt; 30 Days
                </button>
                <button
                    disabled={loading}
                    onClick={() => handleCleanup(7)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                >
                    Clear &gt; 7 Days
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

export default function Settings() {
    const [clearing, setClearing] = useState(false)
    const [message, setMessage] = useState('')
    const [libraryPath, setLibraryPath] = useState(localStorage.getItem('libraryPath') || '')
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const { calculatingBlur, blurProgress, calculateBlurScores } = useAI();

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('settings:getLibraryPath').then(path => {
            setLibraryPath(path)
            localStorage.setItem('libraryPath', path)
        })
    }, [])


    const handleClearAITags = async () => {
        if (!confirm('Are you sure you want to delete ALL AI-generated tags? This cannot be undone.')) return

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

    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [resetInput, setResetInput] = useState('')

    const handleFactoryReset = async () => {
        if (resetInput !== 'RESET') return

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:factoryReset')
            if (res.success) {
                alert("Factory reset complete. Application will now reload.")
                window.location.reload()
            } else {
                alert("Reset failed: " + res.error)
            }
        } catch (e) {
            alert('Failed: ' + e)
        }
    }


    return (
        <div className="p-8 h-full overflow-y-auto bg-gray-900 text-gray-100 relative">
            <h2 className="text-3xl font-bold mb-8 text-white flex items-center justify-between">
                <span>Settings</span>
                <button
                    onClick={() => setShowSettingsModal(true)}
                    className="px-4 py-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-sm font-medium transition-colors"
                >
                    Configure AI Models
                </button>
            </h2>

            <SettingsModal
                open={showSettingsModal}
                onOpenChange={setShowSettingsModal}
            />

            <div className="space-y-12 max-w-2xl">
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
                                        if (confirm(`Move library to:\n${path}\n\nThe application will restart automatically.`)) {
                                            // @ts-ignore
                                            const res = await window.ipcRenderer.invoke('settings:moveLibrary', path)
                                            if (!res.success) {
                                                alert('Move failed: ' + res.error)
                                            }
                                        }
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
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-medium text-white">Model Selection</h4>
                                <p className="text-sm text-gray-400 mt-1">
                                    Choose the balance between speed and accuracy.
                                </p>
                            </div>
                            <select
                                className="bg-gray-700 text-white text-sm px-3 py-2 rounded focus:ring-1 focus:ring-indigo-500 outline-none border border-gray-600"
                                value={localStorage.getItem('ai_profile') || 'balanced'}
                                onChange={(e) => {
                                    localStorage.setItem('ai_profile', e.target.value)
                                    if (confirm('Changing the AI profile requires a reload to load the new models. Reload now?')) {
                                        window.location.reload()
                                    }
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
                    </div>
                </section>

                {/* Preview Cache Management */}
                <section className="space-y-4">
                    <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Preview Cache</h3>
                    <PreviewManager />
                </section>

                {/* Database Management Section */}
                <section className="space-y-4">
                    <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">Database Management</h3>

                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-medium text-white">Clear AI Tags</h4>
                                <p className="text-sm text-gray-400 mt-1">
                                    Removes all tags generated by the AI model. User-added tags are preserved.
                                    Use this if you want to re-scan with a new model.
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

                        {message && (
                            <div className={`p-3 rounded text-sm ${message.includes('Success') ? 'bg-green-900/50 text-green-200' : 'bg-red-900/50 text-red-200'}`}>
                                {message}
                            </div>
                        )}

                        <div className="flex justify-between items-center border-t border-gray-700 pt-4 mt-4">
                            <div>
                                <h4 className="font-medium text-white">Maintenance</h4>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={async () => {
                                        if (confirm('Find and remove duplicate faces? This will keep named faces and remove duplicates.')) {
                                            try {
                                                // @ts-ignore
                                                const res = await window.ipcRenderer.invoke('db:removeDuplicateFaces')
                                                alert(`Cleanup complete. Removed ${res.removedCount} duplicate faces.`)
                                            } catch (e) {
                                                alert('Failed: ' + e)
                                            }
                                        }
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

                        <div className="flex justify-between items-center border-t border-gray-700 pt-4 mt-4">
                            <div>
                                <h4 className="font-medium text-white">Blur Scores</h4>
                                <p className="text-sm text-gray-400 mt-1">
                                    Calculate blur scores for existing faces (if missing).
                                    Required for the "Cleanup Blurry" feature to work on old scans.
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
                    </div>
                </section>
            </div>

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
                                        value={resetInput}
                                        onChange={(e) => setResetInput(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                                        placeholder="Type RESET"
                                    />
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                                    <button
                                        onClick={() => setShowResetConfirm(false)}
                                        className="px-4 py-2 rounded text-gray-300 hover:text-white"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleFactoryReset}
                                        disabled={resetInput !== 'RESET'}
                                        className={`px-4 py-2 rounded font-bold transition-all ${resetInput === 'RESET'
                                            ? 'bg-red-600 hover:bg-red-700 text-white'
                                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                            }`}
                                    >
                                        DELETE EVERYTHING
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    )
}
