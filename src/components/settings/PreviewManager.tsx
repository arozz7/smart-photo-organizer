import { useState, useEffect } from 'react'
import { useAlert } from '../../context/AlertContext';

export default function PreviewManager() {
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
                    Clear {'>'} 30 Days
                </button>
                <button
                    disabled={loading}
                    onClick={() => handleCleanup(7)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                >
                    Clear {'>'} 7 Days
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
