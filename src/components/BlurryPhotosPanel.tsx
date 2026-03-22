import { useState, useEffect, useCallback } from 'react'

type GroupBy = 'folder' | 'location' | 'none'

interface BlurryPhoto {
    id: number
    file_path: string
    blur_score: number
    date_taken: string | null
    metadata_json: string | null
    folder: string
}

interface GroupedPhotos {
    label: string
    photos: BlurryPhoto[]
}

const PAGE_SIZE = 100
const DEFAULT_THRESHOLD = 50

function getLocation(metadataJson: string | null): string {
    if (!metadataJson) return 'No GPS'
    try {
        const m = JSON.parse(metadataJson)
        if (m.GPSLatitude !== undefined && m.GPSLongitude !== undefined) {
            return `${Number(m.GPSLatitude).toFixed(2)}, ${Number(m.GPSLongitude).toFixed(2)}`
        }
    } catch { /* ignore */ }
    return 'No GPS'
}

function groupPhotos(photos: BlurryPhoto[], groupBy: GroupBy): GroupedPhotos[] {
    if (groupBy === 'none') {
        return [{ label: 'All Blurry Photos', photos }]
    }
    const map = new Map<string, BlurryPhoto[]>()
    for (const p of photos) {
        const key = groupBy === 'folder' ? p.folder : getLocation(p.metadata_json)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(p)
    }
    return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, ps]) => ({ label, photos: ps }))
}

function exportCsv(photos: BlurryPhoto[]) {
    const header = ['File Path', 'Folder', 'Blur Score', 'Date Taken', 'Location']
    const rows = photos.map(p => [
        `"${p.file_path.replace(/"/g, '""')}"`,
        `"${p.folder.replace(/"/g, '""')}"`,
        p.blur_score.toFixed(2),
        p.date_taken ?? '',
        getLocation(p.metadata_json),
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `blurry-photos-threshold-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

export default function BlurryPhotosPanel() {
    const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
    const [groupBy, setGroupBy] = useState<GroupBy>('folder')
    const [photos, setPhotos] = useState<BlurryPhoto[]>([])
    const [total, setTotal] = useState(0)
    const [offset, setOffset] = useState(0)
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(false)

    const load = useCallback(async (newOffset = 0, append = false) => {
        setLoading(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('photo:getBlurryPhotos', {
                threshold,
                groupBy,
                limit: PAGE_SIZE,
                offset: newOffset,
            })
            if (res.success) {
                setTotal(res.total)
                setPhotos(prev => append ? [...prev, ...res.photos] : res.photos)
                setHasMore(newOffset + PAGE_SIZE < res.total)
                setOffset(newOffset)
            }
        } catch (e) {
            console.error('[BlurryPhotosPanel] load failed:', e)
        } finally {
            setLoading(false)
        }
    }, [threshold, groupBy])

    useEffect(() => {
        load(0)
    }, [load])

    const handleLoadMore = useCallback(() => {
        load(offset + PAGE_SIZE, true)
    }, [load, offset])

    const grouped = groupPhotos(photos, groupBy)

    return (
        <div className="h-full flex flex-col p-6 gap-4">
            {/* Header */}
            <div>
                <h2 className="text-xl font-semibold text-white">Blurry Photo Export</h2>
                <p className="text-sm text-gray-400 mt-1">
                    Find photos below a sharpness threshold and export the list as CSV.
                </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-end gap-6 bg-gray-800/60 rounded-lg p-4 border border-gray-700">
                {/* Threshold */}
                <div className="flex flex-col gap-1 min-w-[200px]">
                    <label className="text-xs text-gray-400 font-medium">
                        Blur threshold: <span className="text-white font-semibold">{threshold}</span>
                        <span className="text-gray-500 ml-1">(lower = blurrier)</span>
                    </label>
                    <input
                        type="range"
                        min={1}
                        max={500}
                        step={1}
                        value={threshold}
                        onChange={e => setThreshold(Number(e.target.value))}
                        className="w-full accent-indigo-500"
                        aria-label="Blur threshold"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>1 (very blurry)</span>
                        <span>500 (sharp)</span>
                    </div>
                </div>

                {/* Group by */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Group by</label>
                    <div className="flex rounded-md overflow-hidden border border-gray-600">
                        {(['folder', 'location', 'none'] as GroupBy[]).map(g => (
                            <button
                                key={g}
                                onClick={() => setGroupBy(g)}
                                className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                                    groupBy === g
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                {g}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Stats + Export */}
                <div className="flex items-center gap-3 ml-auto">
                    <div className="text-sm text-gray-300">
                        <span className="font-semibold text-white">{total.toLocaleString()}</span>
                        {' '}blurry photo{total !== 1 ? 's' : ''}
                    </div>
                    <button
                        onClick={() => exportCsv(photos)}
                        disabled={photos.length === 0}
                        className="px-4 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    >
                        Export CSV ({photos.length.toLocaleString()})
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-4">
                {loading && photos.length === 0 && (
                    <div className="text-center text-gray-400 py-12">Loading...</div>
                )}
                {!loading && photos.length === 0 && (
                    <div className="text-center text-gray-400 py-12">
                        No photos below threshold {threshold}.
                    </div>
                )}
                {grouped.map(group => (
                    <div key={group.label}>
                        {groupBy !== 'none' && (
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1 flex items-center gap-2">
                                <span className="truncate max-w-lg" title={group.label}>{group.label}</span>
                                <span className="text-gray-500 font-normal normal-case tracking-normal">
                                    ({group.photos.length})
                                </span>
                            </div>
                        )}
                        <div className="bg-gray-800/40 rounded-lg border border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-700/50 text-gray-400 text-xs">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-medium">File</th>
                                        <th className="text-left px-3 py-2 font-medium w-24">Score</th>
                                        <th className="text-left px-3 py-2 font-medium w-36">Date</th>
                                        {groupBy !== 'folder' && (
                                            <th className="text-left px-3 py-2 font-medium">Folder</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700/50">
                                    {group.photos.map(p => (
                                        <tr key={p.id} className="hover:bg-gray-700/30 transition-colors">
                                            <td className="px-3 py-1.5 text-gray-200 font-mono text-xs truncate max-w-xs" title={p.file_path}>
                                                {p.file_path.split(/[\\/]/).pop()}
                                            </td>
                                            <td className="px-3 py-1.5 tabular-nums">
                                                <span className={`font-semibold ${
                                                    p.blur_score < 10 ? 'text-red-400'
                                                    : p.blur_score < 25 ? 'text-orange-400'
                                                    : 'text-yellow-400'
                                                }`}>
                                                    {p.blur_score.toFixed(1)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1.5 text-gray-400 text-xs">
                                                {p.date_taken ? p.date_taken.slice(0, 10) : '—'}
                                            </td>
                                            {groupBy !== 'folder' && (
                                                <td className="px-3 py-1.5 text-gray-500 text-xs truncate max-w-xs" title={p.folder}>
                                                    {p.folder.split(/[\\/]/).slice(-2).join('/')}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}

                {hasMore && (
                    <div className="text-center py-2">
                        <button
                            onClick={handleLoadMore}
                            disabled={loading}
                            className="px-4 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-40"
                        >
                            {loading ? 'Loading…' : `Load more (${total - photos.length} remaining)`}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
