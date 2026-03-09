import { useState, useMemo } from 'react'
import { TrashIcon, CheckIcon, Cross2Icon } from '@radix-ui/react-icons'

interface Photo {
    id: number
    file_path: string
    preview_cache_path: string | null
    width: number | null
    height: number | null
    date_taken: string | null
    sha256_hash: string | null
}

interface DuplicateGroup {
    id: number
    type: 'exact' | 'near'
    status: 'pending' | 'resolved' | 'dismissed'
    winner_photo_id: number | null
    photos: Photo[]
}

interface Props {
    group: DuplicateGroup
    onResolved: () => void
}

function pickBestPhoto(photos: Photo[]): number {
    // Rank by: highest pixel count → first in list (assume earlier date_taken = earlier array order)
    const ranked = [...photos].sort((a, b) => {
        const mpA = (a.width ?? 0) * (a.height ?? 0)
        const mpB = (b.width ?? 0) * (b.height ?? 0)
        if (mpB !== mpA) return mpB - mpA
        // Tie-break: earlier date_taken wins
        const da = a.date_taken ? new Date(a.date_taken).getTime() : Infinity
        const db = b.date_taken ? new Date(b.date_taken).getTime() : Infinity
        return da - db
    })
    return ranked[0].id
}

function photoSrc(photo: Photo): string {
    const src = photo.preview_cache_path ?? photo.file_path
    return `local-resource://${encodeURIComponent(src)}`
}

function resolution(photo: Photo): string {
    if (photo.width && photo.height) return `${photo.width}×${photo.height}`
    return 'Unknown'
}

function fileName(photo: Photo): string {
    return photo.file_path.split(/[\\/]/).pop() ?? photo.file_path
}

export default function DuplicateGroupCard({ group, onResolved }: Props) {
    const suggestedWinnerId = useMemo(() => pickBestPhoto(group.photos), [group.photos])
    const [keepIds, setKeepIds] = useState<Set<number>>(() => new Set([suggestedWinnerId]))
    const [trashLosers, setTrashLosers] = useState(true)
    const [resolving, setResolving] = useState(false)
    const [dismissing, setDismissing] = useState(false)

    function toggleKeep(photoId: number) {
        setKeepIds(prev => {
            // Must keep at least one photo
            if (prev.has(photoId) && prev.size === 1) return prev
            const next = new Set(prev)
            if (next.has(photoId)) next.delete(photoId)
            else next.add(photoId)
            return next
        })
    }

    async function handleResolve() {
        setResolving(true)
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:resolveDuplicateGroup', {
                groupId: group.id,
                keepPhotoIds: Array.from(keepIds),
                trashLosers,
            })
            onResolved()
        } catch (e) {
            console.error('[DuplicateGroupCard] Resolve failed:', e)
        } finally {
            setResolving(false)
        }
    }

    async function handleDismiss() {
        setDismissing(true)
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:dismissDuplicateGroup', { groupId: group.id })
            onResolved()
        } catch (e) {
            console.error('[DuplicateGroupCard] Dismiss failed:', e)
        } finally {
            setDismissing(false)
        }
    }

    const typeBadge = group.type === 'exact'
        ? <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-900/60 text-red-300 border border-red-700">Exact</span>
        : <span className="px-2 py-0.5 rounded text-xs font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700">Similar</span>

    return (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <div className="flex items-center gap-2">
                    {typeBadge}
                    <span className="text-sm text-gray-400">{group.photos.length} photos</span>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={trashLosers}
                            onChange={e => setTrashLosers(e.target.checked)}
                            className="rounded"
                        />
                        Move duplicates to trash
                    </label>
                </div>
            </div>

            {/* Photo filmstrip */}
            <div className="flex gap-3 p-4 overflow-x-auto">
                {group.photos.map(photo => {
                    const isKept = keepIds.has(photo.id)
                    const isSuggested = photo.id === suggestedWinnerId
                    const isLastKept = isKept && keepIds.size === 1
                    return (
                        <div
                            key={photo.id}
                            className={`flex-shrink-0 flex flex-col gap-1 cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                                isKept
                                    ? 'border-indigo-500 shadow-lg shadow-indigo-900/50'
                                    : 'border-gray-700 hover:border-gray-500 opacity-60'
                            }`}
                            style={{ width: 180 }}
                            onClick={() => toggleKeep(photo.id)}
                            title={
                                isLastKept
                                    ? 'At least one photo must be kept'
                                    : isKept
                                        ? 'Click to unselect (will be trashed)'
                                        : 'Click to keep this photo too'
                            }
                        >
                            {/* Thumbnail */}
                            <div className="relative bg-gray-900" style={{ height: 140 }}>
                                <img
                                    src={photoSrc(photo)}
                                    alt={fileName(photo)}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                                {/* Keep / trash indicator */}
                                <div className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow border transition-colors ${
                                    isKept
                                        ? 'bg-indigo-600 border-indigo-500'
                                        : 'bg-gray-800/80 border-gray-600'
                                }`}>
                                    {isKept
                                        ? <CheckIcon className="w-3.5 h-3.5 text-white" />
                                        : <TrashIcon className="w-3 h-3 text-gray-400" />
                                    }
                                </div>
                                {isSuggested && (
                                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-900/80 text-gray-300">
                                        Best
                                    </div>
                                )}
                            </div>

                            {/* Metadata */}
                            <div className="px-2 pb-2 space-y-0.5">
                                <p className="text-xs text-gray-300 truncate" title={fileName(photo)}>
                                    {fileName(photo)}
                                </p>
                                <p className="text-xs text-gray-500">{resolution(photo)}</p>
                                {photo.date_taken && (
                                    <p className="text-xs text-gray-500">
                                        {new Date(photo.date_taken).toLocaleDateString()}
                                    </p>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-900/30">
                <button
                    onClick={handleDismiss}
                    disabled={dismissing || resolving}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                    title="Mark as not duplicates"
                >
                    <Cross2Icon className="w-3.5 h-3.5" />
                    Not duplicates
                </button>

                <button
                    onClick={handleResolve}
                    disabled={resolving || dismissing}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40"
                >
                    {resolving ? (
                        <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                        trashLosers ? <TrashIcon className="w-3.5 h-3.5" /> : <CheckIcon className="w-3.5 h-3.5" />
                    )}
                    Keep {keepIds.size === 1 ? 'selected' : `${keepIds.size} selected`}{trashLosers ? ' & trash others' : ''}
                </button>
            </div>
        </div>
    )
}
