import { useState, useEffect } from 'react'
import { useAI } from '../context/AIContext'
import { useScan } from '../context/ScanContext'

interface PhotoDetailProps {
    photo: any
    onClose: () => void
    onNext: () => void
    onPrev: () => void
}

export default function PhotoDetail({ photo, onClose, onNext, onPrev }: PhotoDetailProps) {
    const [metadata, setMetadata] = useState<any>(null)
    const [imagePath, setImagePath] = useState<string>('')
    const [tags, setTags] = useState<string[]>([])
    const { onPhotoProcessed } = useAI()
    const [faces, setFaces] = useState<any[]>([])
    const { loadTags, setFilter } = useScan()

    // We need access to navigation or just close and set filter
    // If we want to navigate to Library with filter:
    // Ideally we use a router hook, but simplistic:
    // We already have setFilter from context.

    // We need access to navigation or just close and set filter
    // If we want to navigate to Library with filter:
    // Ideally we use a router hook, but simplistic:
    // We already have setFilter from context.

    const [newTag, setNewTag] = useState('')

    useEffect(() => {
        if (photo) {
            console.log("[UI] Photo Detail Object:", photo);
            // Parse metadata if it exists
            if (photo.metadata_json) {
                console.log("[UI] Raw metadata:", photo.metadata_json);
                try {
                    setMetadata(JSON.parse(photo.metadata_json))
                } catch (e) {
                    setMetadata(null)
                }
            } else {
                setMetadata(null)
            }

            // Determine image path (prefer preview for speed, or original if supported)
            // For detail view, we likely want the original if it's displayable by Chrome (jpg/png),
            // but for RAWs we must use the preview.
            // Let's use the local-resource protocol.
            const ext = photo.file_path.split('.').pop()?.toLowerCase()
            const isWebFriendly = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext || '')

            // If it's a raw file, we MUST use the preview_cache_path
            const pathToLoad = isWebFriendly ? photo.file_path : (photo.preview_cache_path || photo.file_path)
            console.log(`[UI] Loading image from: ${pathToLoad} (isWebFriendly: ${isWebFriendly}, hasPreview: ${!!photo.preview_cache_path})`);

            setImagePath(`local-resource://${encodeURIComponent(pathToLoad)}`)

            // Fetch tags
            fetchTags()
        } else {
            setTags([])
            setFaces([])
        }
    }, [photo])

    // Auto-refresh when AI finishes this photo
    useEffect(() => {
        if (!photo) return;
        return onPhotoProcessed((id) => {
            if (id === photo.id) {
                console.log("[UI] AI finished processing this photo, refreshing tags...");
                fetchTags();
                loadTags(); // Refresh global list too
            }
        });
    }, [photo, onPhotoProcessed])

    const fetchTags = async () => {
        try {
            // @ts-ignore
            const t = await window.ipcRenderer.invoke('db:getTags', photo.id)
            setTags(t)

            // Also fetch faces
            // @ts-ignore
            const f = await window.ipcRenderer.invoke('db:getFaces', photo.id)
            setFaces(f.map((face: any) => ({ ...face, width: photo.width, height: photo.height })))
        } catch (e) {
            console.error(e)
        }
    }

    const handlePersonClick = (personId: number) => {
        setFilter({ people: [personId] })
        onClose()
    }

    const handleAddTag = async () => {
        if (!newTag.trim()) return
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:addTags', { photoId: photo.id, tags: [newTag.trim()] })
            setNewTag('')
            fetchTags()
            loadTags()
        } catch (e) {
            console.error(e)
        }
    }

    const handleRemoveTag = async (tag: string) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:removeTag', { photoId: photo.id, tag })
            fetchTags()
            loadTags()
        } catch (e) {
            console.error(e)
        }
    }

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowRight') onNext()
            if (e.key === 'ArrowLeft') onPrev()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose, onNext, onPrev])

    if (!photo) return null

    return (
        <div className="fixed inset-0 z-50 flex bg-black/95 backdrop-blur-sm">
            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-4 left-4 z-50 p-2 text-white/70 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-colors"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* Main Image Area */}
            <div className="flex-1 relative flex items-center justify-center p-4 min-w-0 min-h-0">
                {/* Navigation Buttons (Overlay) */}
                <button
                    onClick={onPrev}
                    className="absolute left-4 p-4 text-white/50 hover:text-white transition-colors hover:scale-110 transform z-10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>

                <div className="flex-1 bg-black flex items-center justify-center overflow-hidden relative group min-w-0 min-h-0 w-full h-full">
                    {(() => {
                        const ext = photo.file_path.split('.').pop()?.toLowerCase() || ''
                        const isWebFriendly = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
                        const hasPreview = !!photo.preview_cache_path

                        if (!isWebFriendly && !hasPreview) {
                            return (
                                <div className="text-gray-400 flex flex-col items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span>Preview Unavailable</span>
                                    <span className="text-xs text-gray-500">Run 'Scan Folder' to generate previews for RAW files.</span>
                                </div>
                            )
                        }

                        return (
                            <img
                                src={imagePath}
                                alt={photo.file_path.split(/[\\/]/).pop()}
                                className="max-w-full max-h-full object-contain shadow-2xl"
                            />
                        )
                    })()}
                </div>

                <button
                    onClick={onNext}
                    className="absolute right-4 p-4 text-white/50 hover:text-white transition-colors hover:scale-110 transform"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>

            {/* Right Sidebar - Metadata */}
            <div className="w-80 bg-gray-900 border-l border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto shrink-0">
                <div>
                    <h3 className="text-white font-semibold text-lg mb-1 truncate" title={photo.file_path.split('\\').pop()}>
                        {photo.file_path.split('\\').pop()}
                    </h3>
                    <p className="text-gray-400 text-xs break-all">{photo.file_path}</p>
                </div>

                {metadata && (
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
                )}

                {/* People Section */}
                <div className="space-y-2">
                    <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider">People</h4>
                    {faces.length === 0 ? (
                        <p className="text-gray-500 text-sm italic">No people detected</p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <div className="flex flex-wrap gap-2">
                                {(() => {
                                    const seenPeople = new Set<number>();
                                    return faces.map((face, idx) => {
                                        if (face.person_name) {
                                            if (seenPeople.has(face.person_id)) return null;
                                            seenPeople.add(face.person_id);
                                            return (
                                                <button
                                                    key={face.person_id}
                                                    onClick={() => handlePersonClick(face.person_id)}
                                                    className="px-2 py-1 bg-purple-900/50 text-purple-200 text-xs rounded-full border border-purple-700/50 hover:bg-purple-800/50 transition-colors flex items-center gap-1"
                                                >
                                                    <span className="text-xs">👤</span> {face.person_name}
                                                </button>
                                            );
                                        }
                                        return (
                                            <span key={face.id} className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded-full border border-gray-700 flex items-center gap-1" title="Unnamed Face">
                                                <span className="text-xs">❓</span> Unnamed
                                            </span>
                                        );
                                    });
                                })()}
                            </div>
                        </div>
                    )}
                </div>

                {/* Tags Section */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider">Tags</h4>
                    </div>

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

                    {/* Add Tag Input */}
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

                    {/* Smart Tags Button */}
                    <div className="mt-2 text-right">
                        <button
                            onClick={async () => {
                                try {
                                    // @ts-ignore
                                    await window.ipcRenderer.invoke('ai:generateTags', { photoId: photo.id })
                                    // Results will come via onPhotoProcessed, triggering auto-refresh
                                } catch (e) {
                                    console.error(e)
                                }
                            }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center justify-end gap-1 w-full"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                            Generate Smart Tags
                        </button>
                    </div>
                </div>

                {/* Fallback if no metadata */}
                {!metadata && (
                    <div className="p-4 bg-gray-800 rounded text-center">
                        <p className="text-gray-400 text-sm">No EXIF data available</p>
                    </div>
                )}
            </div>
        </div>
    )
}
