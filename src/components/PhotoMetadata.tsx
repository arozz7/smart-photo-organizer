import { useScan } from '../context/ScanContext'
import { useAI } from '../context/AIContext'

interface PhotoMetadataProps {
    photo: any
    metadata: any
    tags: string[]
    newTag: string
    setNewTag: (t: string) => void
    isScanning: boolean
    setIsScanning: (b: boolean) => void
    onGoToFolder: () => void
    onTagsChanged: () => void
}

export function PhotoMetadata({ photo, metadata, tags, newTag, setNewTag, isScanning, setIsScanning, onGoToFolder, onTagsChanged }: PhotoMetadataProps) {
    const { loadTags, refreshPhoto } = useScan()
    const { addToQueue } = useAI()

    const handleAddTag = async () => {
        if (!newTag.trim()) return
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:addTags', { photoId: photo.id, tags: [newTag.trim()] })
            setNewTag('')
            onTagsChanged()
            loadTags()
        } catch (e) {
            console.error(e)
        }
    }

    const handleRemoveTag = async (tag: string) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:removeTag', { photoId: photo.id, tag })
            onTagsChanged()
            loadTags()
        } catch (e) {
            console.error(e)
        }
    }

    return (
        <>
            {/* File path */}
            <div>
                <h3 className="text-white font-semibold text-lg mb-1 truncate" title={photo.file_path.split(/[\\/]/).pop()}>
                    {photo.file_path.split(/[\\/]/).pop()}
                </h3>
                <div className="flex flex-col gap-1">
                    <p className="text-gray-400 text-xs break-all leading-relaxed">{photo.file_path}</p>
                    <button
                        onClick={onGoToFolder}
                        className="text-indigo-400 hover:text-indigo-300 text-[10px] font-bold flex items-center gap-1 mt-1 transition-colors self-start"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        Go to Folder
                    </button>
                </div>
            </div>

            {/* EXIF Data */}
            {metadata ? (
                <div className="space-y-4">
                    <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider">EXIF Data</h4>
                    <div className="grid grid-cols-2 gap-4">
                        {metadata.Model && (
                            <div className="col-span-2">
                                <p className="text-gray-500 text-xs">Camera</p>
                                <p className="text-gray-200 text-sm">{metadata.Model}</p>
                            </div>
                        )}
                        {metadata.ISO && (
                            <div>
                                <p className="text-gray-500 text-xs">ISO</p>
                                <p className="text-gray-200 text-sm">{metadata.ISO}</p>
                            </div>
                        )}
                        {metadata.FNumber && (
                            <div>
                                <p className="text-gray-500 text-xs">Aperture</p>
                                <p className="text-gray-200 text-sm">f/{metadata.FNumber}</p>
                            </div>
                        )}
                        {metadata.ExposureTime && (
                            <div>
                                <p className="text-gray-500 text-xs">Shutter</p>
                                <p className="text-gray-200 text-sm">{metadata.ExposureTime}s</p>
                            </div>
                        )}
                        {metadata.FocalLength && (
                            <div>
                                <p className="text-gray-500 text-xs">Focal Length</p>
                                <p className="text-gray-200 text-sm">{metadata.FocalLength}</p>
                            </div>
                        )}
                        {metadata.DateTimeOriginal && (
                            <div className="col-span-2">
                                <p className="text-gray-500 text-xs">Taken</p>
                                <p className="text-gray-200 text-sm">
                                    {metadata.DateTimeOriginal?.rawValue ? metadata.DateTimeOriginal.rawValue : metadata.DateTimeOriginal.toString()}
                                </p>
                            </div>
                        )}
                        {photo.blur_score !== undefined && photo.blur_score !== null && (
                            <div className="col-span-2">
                                <p className="text-gray-500 text-xs">Sharpness Score</p>
                                <div className="flex items-center gap-2">
                                    <p className="text-gray-200 text-sm">{photo.blur_score.toFixed(1)}</p>
                                    <div className="h-1.5 w-24 bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${photo.blur_score < 20 ? 'bg-red-500' : photo.blur_score < 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                            style={{ width: `${Math.min(100, Math.max(0, photo.blur_score))}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="p-4 bg-gray-800 rounded text-center">
                    <p className="text-gray-400 text-sm">No EXIF data available</p>
                </div>
            )}

            {/* Tags */}
            <div className="space-y-2">
                <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider">Tags</h4>
                <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                        <span key={tag} className="px-2 py-1 bg-indigo-900/50 text-indigo-200 text-xs rounded-full border border-indigo-700/50 flex items-center gap-1 group">
                            {tag}
                            <button
                                onClick={() => handleRemoveTag(tag)}
                                className="hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                &times;
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2 mt-2">
                    <input
                        type="text"
                        className="bg-gray-800 text-gray-200 text-xs px-2 py-1 rounded border border-gray-700 focus:outline-none focus:border-indigo-500 flex-1"
                        placeholder="Add tag..."
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    />
                    <button
                        onClick={handleAddTag}
                        className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
                    >
                        +
                    </button>
                </div>

                {/* Force Rescan */}
                <div className="mt-4 text-right border-t border-gray-800 pt-3">
                    <button
                        onClick={async () => {
                            try {
                                // @ts-ignore
                                const scanned = await window.ipcRenderer.invoke('scan-files', [photo.file_path], { forceRescan: true })
                                if (scanned && scanned.length > 0) {
                                    const items = scanned.map((p: any) => ({ ...p, cleanRescan: true }))
                                    addToQueue(items, true)
                                    refreshPhoto(photo.id)
                                }
                            } catch (e) {
                                console.error(e)
                            }
                        }}
                        className="text-xs text-orange-400 hover:text-orange-300 flex items-center justify-end gap-1 w-full"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Force Rescan Faces (Debug)
                    </button>
                </div>

                {/* Smart Tags */}
                <div className="mt-2 text-right">
                    <button
                        onClick={async () => {
                            try {
                                // @ts-ignore
                                const res = await window.ipcRenderer.invoke('ai:generateTags', { photoId: photo.id })
                                if (res && (res.tags || res.description)) {
                                    refreshPhoto(photo.id)
                                }
                            } catch (e) {
                                console.error(e)
                            }
                        }}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center justify-end gap-1 w-full"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                        Generate Smart Tags {photo.description ? '(Regenerate)' : ''}
                    </button>
                </div>

                {/* AI Description */}
                {photo.description && (
                    <div className="space-y-1 mt-4 border-t border-gray-800 pt-3">
                        <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            AI Description
                        </h4>
                        <p className="text-gray-300 text-xs leading-relaxed italic bg-gray-800/50 p-2 rounded">
                            {photo.description}
                        </p>
                    </div>
                )}
            </div>
        </>
    )
}
