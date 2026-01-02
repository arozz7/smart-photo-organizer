import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAI } from '../context/AIContext'
import { useScan } from '../context/ScanContext'
import { usePeople } from '../context/PeopleContext'
import { useAlert } from '../context/AlertContext'

interface PhotoDetailProps {
    photo: any
    onClose: () => void
    onNext: () => void
    onPrev: () => void
}

export default function PhotoDetail({ photo, onClose, onNext, onPrev }: PhotoDetailProps) {
    const navigate = useNavigate()
    const { loadTags, setFilter, refreshPhoto } = useScan()
    const { onPhotoProcessed } = useAI()
    const { assignPerson, people, loadPeople } = usePeople()
    const { showConfirm } = useAlert()

    const [metadata, setMetadata] = useState<any>(null)
    const [imagePath, setImagePath] = useState<string>('')
    const [visualRotation, setVisualRotation] = useState(0)
    const [tags, setTags] = useState<string[]>([])
    const [faces, setFaces] = useState<any[]>([])
    const [newTag, setNewTag] = useState('')
    // Face Naming State
    const [namingFaceId, setNamingFaceId] = useState<number | null>(null)
    const [nameFilter, setNameFilter] = useState('')
    const [showSuggestions, setShowSuggestions] = useState(false)

    // Ensure people list is loaded for type-ahead
    useEffect(() => {
        if (people.length === 0) {
            loadPeople();
        }
    }, [people.length, loadPeople]);


    const [isRotating, setIsRotating] = useState(false)
    const [showFaceBoxes, setShowFaceBoxes] = useState(true)
    const [showUnnamedFaces, setShowUnnamedFaces] = useState(true)
    const [reassigningGroup, setReassigningGroup] = useState<{ id: number, name: string, faceIds: number[] } | null>(null);
    const [reassignName, setReassignName] = useState('');
    const [imgRect, setImgRect] = useState<{ width: number, height: number, left: number, top: number } | null>(null)
    const imgRef = useRef<HTMLImageElement>(null)
    const photoAreaRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (photo) {
            console.log("[UI] Photo Detail Object:", photo);
            // Parse metadata if it exists
            if (photo.metadata_json) {
                console.debug("[UI] Raw metadata:", photo.metadata_json);
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

    const handleUnassign = async (faceIds: number[]) => {
        showConfirm({
            title: 'Unassign Faces',
            description: `Are you sure you want to remove the name association for ${faceIds.length} face(s)? They will become unnamed.`,
            confirmLabel: 'Unassign',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:unassignFaces', faceIds);
                    fetchTags();
                } catch (e) {
                    console.error(e);
                }
            }
        });
    }

    const handleIgnore = async (faceIds: number[]) => {
        showConfirm({
            title: 'Ignore Faces',
            description: `Are you sure you want to ignore ${faceIds.length} face(s)? They will no longer appear in scan results.`,
            confirmLabel: 'Ignore',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:ignoreFaces', faceIds);
                    fetchTags();
                } catch (e) {
                    console.error(e);
                }
            }
        });
    }

    const handleReassign = async () => {
        if (!reassigningGroup || !reassignName.trim()) return;
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: reassigningGroup.faceIds,
                personName: reassignName.trim()
            });
            setReassigningGroup(null);
            setReassignName('');
            fetchTags();
        } catch (e) {
            console.error(e);
        }
    }

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowRight') onNext()
            if (e.key === 'ArrowLeft') onPrev()
        }
        window.addEventListener('keydown', handleKeyDown)

        // Handle window resize to update box positions
        const handleResize = () => {
            if (imgRef.current) {
                updateImgRect(imgRef.current);
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleResize);
        }
    }, [onClose, onNext, onPrev])

    useEffect(() => {
        const loadDefaultHide = async () => {
            try {
                // @ts-ignore
                const settings = await window.ipcRenderer.invoke('ai:getSettings');
                if (settings && settings.hideUnnamedFacesByDefault === true) {
                    setShowUnnamedFaces(false);
                }
            } catch (e) {
                console.error("Failed to load default hide setting:", e);
            }
        };
        loadDefaultHide();
    }, []);

    useEffect(() => {
        if (imgRef.current) {
            updateImgRect(imgRef.current);
        }
    }, [visualRotation]);

    const updateImgRect = (img: HTMLImageElement) => {
        const area = photoAreaRef.current;
        if (!area) return;

        const cw = area.clientWidth;
        const ch = area.clientHeight;

        const isRotated = (visualRotation / 90) % 2 !== 0;
        const maxW = isRotated ? ch : cw;
        const maxH = isRotated ? cw : ch;

        const iw = img.naturalWidth;
        const ih = img.naturalHeight;

        if (!iw || !ih) return;

        const aspect = iw / ih;
        const containerAspect = maxW / maxH;

        let renderedW, renderedH;

        if (aspect > containerAspect) {
            renderedW = maxW;
            renderedH = maxW / aspect;
        } else {
            renderedH = maxH;
            renderedW = maxH * aspect;
        }

        setImgRect({ width: renderedW, height: renderedH, left: 0, top: 0 });
    }

    const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        updateImgRect(e.currentTarget);
    }

    const handleGoToFolder = () => {
        const path = photo.file_path;
        const folder = path.substring(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
        setFilter({ folder });
        onClose();
    }

    if (!photo) return null

    // Portal the detail view to body to escape inert containers
    return createPortal(
        <div className="fixed inset-0 z-[100] flex bg-black/95 backdrop-blur-sm pointer-events-auto">
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

                <div
                    ref={photoAreaRef}
                    className="flex-1 bg-black flex items-center justify-center overflow-hidden relative group min-w-0 min-h-0 w-full h-full"
                >
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
                            <div
                                className="relative transition-transform duration-300 ease-in-out"
                                style={{
                                    transform: `rotate(${visualRotation}deg)`,
                                    width: imgRect ? imgRect.width : 'auto',
                                    height: imgRect ? imgRect.height : 'auto'
                                }}
                            >
                                <img
                                    ref={imgRef}
                                    src={imagePath}
                                    alt={photo.file_path.split(/[\\/]/).pop()}
                                    className="w-full h-full object-contain shadow-2xl"
                                    onLoad={handleImgLoad}
                                />
                                {imgRect && (
                                    <div
                                        className="absolute top-0 left-0 w-full h-full pointer-events-none"
                                    >
                                        {faces
                                            .filter(f => showFaceBoxes && (showUnnamedFaces || f.person_name))
                                            .map((face) => {
                                                const scaleX = imgRect.width / (photo.width || 1);
                                                const scaleY = imgRect.height / (photo.height || 1);
                                                const { x, y, width, height } = face.box;

                                                return (
                                                    <div
                                                        key={face.id}
                                                        onClick={(e) => {
                                                            if (!face.person_name) {
                                                                e.stopPropagation();
                                                                setNamingFaceId(face.id);
                                                                setNameFilter('');
                                                            }
                                                        }}
                                                        className={`absolute border-2 ${face.person_name ? 'border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'border-indigo-500/50 shadow-[0_0_8px_rgba(79,70,229,0.3)] cursor-pointer hover:border-white hover:bg-white/10 pointer-events-auto'} rounded-sm`}
                                                        style={{
                                                            left: x * scaleX,
                                                            top: y * scaleY,
                                                            width: width * scaleX,
                                                            height: height * scaleY
                                                        }}
                                                        title={face.person_name || "Click to name"}
                                                    >
                                                        {face.person_name && (
                                                            <div className="absolute -top-5 left-0 bg-purple-600 text-white text-[9px] px-1 py-0.5 rounded-t whitespace-nowrap font-bold">
                                                                {face.person_name}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                    </div>
                                )}
                            </div>
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
                    <h3 className="text-white font-semibold text-lg mb-1 truncate" title={photo.file_path.split(/[\\/]/).pop()}>
                        {photo.file_path.split(/[\\/]/).pop()}
                    </h3>
                    <div className="flex flex-col gap-1">
                        <p className="text-gray-400 text-xs break-all leading-relaxed">{photo.file_path}</p>
                        <button
                            onClick={handleGoToFolder}
                            className="text-indigo-400 hover:text-indigo-300 text-[10px] font-bold flex items-center gap-1 mt-1 transition-colors self-start"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                            Go to Folder
                        </button>
                    </div>
                </div>

                {/* Enhance Button */}
                <div className="pb-4 border-b border-gray-800 space-y-3">
                    <button
                        onClick={() => {
                            onClose();
                            navigate(`/enhance/${photo.id}`, { state: { photo } });
                        }}
                        className="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded font-bold shadow-lg flex items-center justify-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
                        Enhance Photo
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => setVisualRotation(prev => prev - 90)}
                            className="py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm font-medium flex items-center justify-center gap-2"
                            title="Rotate Left (Preview)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                            Left
                        </button>
                        <button
                            onClick={() => setVisualRotation(prev => prev + 90)}
                            className="py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm font-medium flex items-center justify-center gap-2"
                            title="Rotate Right (Preview)"
                        >
                            Right
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                            </svg>
                        </button>
                        {visualRotation % 360 !== 0 && (
                            <button
                                onClick={() => {
                                    showConfirm({
                                        title: 'Save Rotation',
                                        description: `Save rotation of ${visualRotation} degrees? This will modify the original file and re-scan for faces.`,
                                        confirmLabel: 'Save & Re-Scan',
                                        onConfirm: async () => {
                                            try {
                                                setIsRotating(true);
                                                await window.ipcRenderer.invoke('ai:rotateImage', { photoId: photo.id, rotation: visualRotation });
                                                await refreshPhoto(photo.id);
                                                onClose();
                                            } catch (e) {
                                                alert("Rotation failed: " + e);
                                            } finally {
                                                setIsRotating(false);
                                            }
                                        }
                                    });
                                }}
                                disabled={isRotating}
                                className={`col-span-2 w-full py-2 ${isRotating ? 'bg-gray-600 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 animate-pulse'} text-white rounded font-bold shadow-lg flex items-center justify-center gap-2`}
                            >
                                {isRotating ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Saving & Re-Scanning...
                                    </>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Save Rotation
                                    </>
                                )}
                            </button>
                        )}
                    </div>
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
                    <div className="flex items-center justify-between">
                        <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider">People</h4>
                        <div className="flex gap-1">
                            <button
                                onClick={() => setShowFaceBoxes(!showFaceBoxes)}
                                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${showFaceBoxes ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                                title={showFaceBoxes ? 'Hide all face boxes' : 'Show face boxes'}
                            >
                                {showFaceBoxes ? 'Boxes' : 'No Boxes'}
                            </button>
                            {showFaceBoxes && (
                                <button
                                    onClick={() => setShowUnnamedFaces(!showUnnamedFaces)}
                                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${showUnnamedFaces ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                                    title={showUnnamedFaces ? 'Hide unnamed face boxes' : 'Show all face boxes'}
                                >
                                    {showUnnamedFaces ? 'Show All' : 'Named Only'}
                                </button>
                            )}
                        </div>
                    </div>
                    {faces.length === 0 ? (
                        <div className="flex items-center gap-2">
                            <p className="text-gray-500 text-sm italic">No people detected</p>
                            <button
                                onClick={async () => {
                                    try {
                                        // @ts-ignore
                                        await window.ipcRenderer.invoke('ai:analyzeImage', { photoId: photo.id, scanMode: 'MACRO', enableVLM: false, debug: true })
                                    } catch (e) {
                                        console.error(e)
                                    }
                                }}
                                className="px-2 py-1 bg-indigo-900/30 text-indigo-300 text-xs rounded border border-indigo-500/30 hover:bg-indigo-900/50 transition-colors"
                                title="Force deep scan for faces (Macro Mode)"
                            >
                                Force Face Scan
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <div className="flex flex-wrap gap-2 items-center">
                                {(() => {
                                    const groups: Record<number, { id: number, name: string, faceIds: number[] }> = {};
                                    faces.forEach(f => {
                                        if (f.person_id) {
                                            if (!groups[f.person_id]) {
                                                groups[f.person_id] = { id: f.person_id, name: f.person_name, faceIds: [] };
                                            }
                                            groups[f.person_id].faceIds.push(f.id);
                                        }
                                    });
                                    const faceGroups = Object.values(groups);

                                    return faceGroups.map((group) => {
                                        const isEditing = reassigningGroup?.id === group.id;

                                        return (
                                            <div key={group.id} className="relative group inline-flex items-center justify-center">
                                                {isEditing ? (
                                                    <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-full border border-indigo-500/50 relative z-10">
                                                        <input
                                                            autoFocus
                                                            type="text"
                                                            className="bg-transparent text-white text-[10px] px-2 py-0.5 outline-none w-24"
                                                            placeholder="New name..."
                                                            value={reassignName}
                                                            onChange={(e) => setReassignName(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleReassign();
                                                                if (e.key === 'Escape') setReassigningGroup(null);
                                                            }}
                                                        />
                                                        <button
                                                            onClick={handleReassign}
                                                            className="text-green-400 hover:text-green-300 p-1"
                                                            title="Save"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => setReassigningGroup(null)}
                                                            className="text-red-400 hover:text-red-300 p-1"
                                                            title="Cancel"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => handlePersonClick(group.id)}
                                                            className="px-2 py-1 bg-purple-900/50 text-purple-200 text-xs rounded-full border border-purple-700/50 hover:bg-purple-800/50 transition-colors flex items-center gap-1"
                                                        >
                                                            <span className="text-xs">👤</span> {group.name} {group.faceIds.length > 1 && <span className="opacity-50 text-[10px]">x{group.faceIds.length}</span>}
                                                        </button>

                                                        {/* Actions on Hover */}
                                                        <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 pb-1 z-30">
                                                            <div className="flex items-center gap-1 bg-gray-900 border border-gray-700 p-1.5 rounded-lg shadow-xl whitespace-nowrap relative">
                                                                <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45"></div>
                                                                <button
                                                                    onClick={() => { setReassigningGroup(group); setReassignName(group.name); }}
                                                                    className="p-1 text-gray-400 hover:text-indigo-400 transition-colors"
                                                                    title="Correct Name"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                                    </svg>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleUnassign(group.faceIds)}
                                                                    className="p-1 text-gray-400 hover:text-yellow-400 transition-colors"
                                                                    title="Unassign (Make Unnamed)"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                                    </svg>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleIgnore(group.faceIds)}
                                                                    className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                                                                    title="Ignore Face"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.046m4.596-1.596A9.964 9.964 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    });
                                })()}
                                <button
                                    onClick={async () => {
                                        try {
                                            // @ts-ignore
                                            await window.ipcRenderer.invoke('ai:analyzeImage', { photoId: photo.id, scanMode: 'MACRO', enableVLM: false, debug: true })
                                        } catch (e) {
                                            console.error(e)
                                        }
                                    }}
                                    className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded-full border border-gray-700 hover:bg-gray-700 hover:text-gray-200 transition-colors flex items-center gap-1"
                                    title="Force deep scan for missed faces"
                                >
                                    <span className="text-xs">🔍</span>
                                </button>
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
                                    const res = await window.ipcRenderer.invoke('ai:generateTags', { photoId: photo.id })
                                    if (res && (res.tags || res.description)) {
                                        refreshPhoto(photo.id);
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

                {/* Fallback if no metadata */}
                {!metadata && (
                    <div className="p-4 bg-gray-800 rounded text-center">
                        <p className="text-gray-400 text-sm">No EXIF data available</p>
                    </div>
                )}
            </div>

            {/* Naming Modal */}
            {namingFaceId && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center" onClick={() => setNamingFaceId(null)}>
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-96 border border-gray-700" onClick={e => e.stopPropagation()}>
                        <h3 className="text-white font-bold mb-4">Name this person</h3>

                        <div className="space-y-4">
                            <div>
                                <div className="relative">
                                    <input
                                        autoFocus
                                        type="text"
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-indigo-500 outline-none"
                                        placeholder="Search or enter name..."
                                        value={nameFilter}
                                        onChange={(e) => {
                                            setNameFilter(e.target.value);
                                            setShowSuggestions(true);
                                        }}
                                        onFocus={() => setShowSuggestions(true)}
                                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && nameFilter.trim()) {
                                                assignPerson(namingFaceId, nameFilter.trim());
                                                setNamingFaceId(null);
                                                setTimeout(fetchTags, 500);
                                            }
                                            if (e.key === 'Escape') setNamingFaceId(null);
                                        }}
                                    />
                                    {showSuggestions && (
                                        <div className="absolute top-full left-0 w-full mt-1 bg-gray-900 border border-gray-700 rounded shadow-xl max-h-48 overflow-y-auto z-50">
                                            {people
                                                .filter(p => !nameFilter || p.name.toLowerCase().includes(nameFilter.toLowerCase()))
                                                .slice(0, 50)
                                                .map(person => (
                                                    <button
                                                        key={person.id}
                                                        onClick={() => {
                                                            assignPerson(namingFaceId, person.name);
                                                            setNamingFaceId(null);
                                                            setTimeout(fetchTags, 500);
                                                        }}
                                                        className="w-full text-left p-2 hover:bg-gray-800 text-gray-300 hover:text-white flex items-center gap-2 transition-colors border-b border-gray-800 last:border-0"
                                                    >
                                                        <div className="w-6 h-6 bg-indigo-900 rounded-full flex items-center justify-center text-[10px] shrink-0 text-white font-bold">
                                                            {person.name[0]}
                                                        </div>
                                                        <span className="truncate">{person.name}</span>
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-700">
                                <button
                                    onClick={() => setNamingFaceId(null)}
                                    className="px-3 py-1 text-gray-400 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        if (nameFilter.trim()) {
                                            assignPerson(namingFaceId, nameFilter.trim());
                                            setNamingFaceId(null);
                                            setTimeout(fetchTags, 500);
                                        }
                                    }}
                                    className="px-4 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={!nameFilter.trim()}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div >,
        document.body
    )
}
