import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAI } from '../context/AIContext'
import { useScan } from '../context/ScanContext'
import { usePeople } from '../context/PeopleContext'
import { PhotoViewer } from './PhotoViewer'
import { PhotoActions } from './PhotoActions'
import { FaceOverlay } from './FaceOverlay'
import { PhotoMetadata } from './PhotoMetadata'

interface PhotoDetailProps {
    photo: any
    onClose: () => void
    onNext: () => void
    onPrev: () => void
}

export default function PhotoDetail({ photo, onClose, onNext, onPrev }: PhotoDetailProps) {
    const { loadTags, setFilter } = useScan()
    const { onPhotoProcessed } = useAI()
    const { people, loadPeople } = usePeople()

    const [metadata, setMetadata] = useState<any>(null)
    const [imagePath, setImagePath] = useState('')
    const [imageRetryCount, setImageRetryCount] = useState(0)
    const [visualRotation, setVisualRotation] = useState(0)
    const [tags, setTags] = useState<string[]>([])
    const [faces, setFaces] = useState<any[]>([])
    const [newTag, setNewTag] = useState('')
    const [namingFaceId, setNamingFaceId] = useState<number | null>(null)
    const [nameFilter, setNameFilter] = useState('')
    const [isRotating, setIsRotating] = useState(false)
    const [showFaceBoxes, setShowFaceBoxes] = useState(true)
    const [showUnnamedFaces, setShowUnnamedFaces] = useState(true)
    const [isScanning, setIsScanning] = useState(false)

    // Ensure people list is loaded for PersonNameInput typeahead
    useEffect(() => {
        if (people.length === 0) loadPeople()
    }, [people.length, loadPeople])

    useEffect(() => {
        if (photo) {
            console.log('[UI] Photo Detail Object:', photo)
            if (photo.metadata_json) {
                try { setMetadata(JSON.parse(photo.metadata_json)) } catch { setMetadata(null) }
            } else {
                setMetadata(null)
            }
            console.log(`[UI] Loading image from file_path: ${photo.file_path}`)
            setImagePath(`local-resource://${encodeURIComponent(photo.file_path)}?t=${Date.now()}`)
            setImageRetryCount(0)
            fetchTags()
        } else {
            setTags([])
            setFaces([])
        }
    }, [photo])

    // Auto-refresh when AI finishes processing this photo
    useEffect(() => {
        if (!photo) return
        return onPhotoProcessed((id) => {
            if (id === photo.id) {
                console.log('[UI] AI finished processing this photo, refreshing tags...')
                fetchTags()
                loadTags()
            }
        })
    }, [photo, onPhotoProcessed])

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowRight') onNext()
            if (e.key === 'ArrowLeft') onPrev()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose, onNext, onPrev])

    // Load the "hide unnamed faces" setting on mount
    useEffect(() => {
        const loadDefaultHide = async () => {
            try {
                // @ts-ignore
                const settings = await window.ipcRenderer.invoke('ai:getSettings')
                if (settings?.hideUnnamedFacesByDefault === true) setShowUnnamedFaces(false)
            } catch (e) {
                console.error('Failed to load default hide setting:', e)
            }
        }
        loadDefaultHide()
    }, [])

    const fetchTags = async () => {
        try {
            // @ts-ignore
            const t = await window.ipcRenderer.invoke('db:getTags', photo.id)
            setTags(t)
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

    const handleGoToFolder = () => {
        const path = photo.file_path
        const folder = path.substring(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')))
        setFilter({ folder })
        onClose()
    }

    if (!photo) return null

    return createPortal(
        <div className="fixed inset-0 z-modal flex bg-black/95 backdrop-blur-sm pointer-events-auto">
            <button
                onClick={onClose}
                className="absolute top-4 left-4 z-overlay flex items-center gap-1.5 px-3 py-2 text-white/80 hover:text-white bg-black/60 hover:bg-black/80 rounded-full border border-white/10 hover:border-white/30 transition-all backdrop-blur-sm"
                aria-label="Close photo detail"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="text-xs font-medium">Close</span>
                <span className="text-[10px] text-white/40 font-mono">ESC</span>
            </button>

            <PhotoViewer
                key={photo.id}
                photo={photo}
                imagePath={imagePath}
                imageRetryCount={imageRetryCount}
                setImageRetryCount={setImageRetryCount}
                setImagePath={setImagePath}
                visualRotation={visualRotation}
                faces={faces}
                showFaceBoxes={showFaceBoxes}
                showUnnamedFaces={showUnnamedFaces}
                onPrev={onPrev}
                onNext={onNext}
                onFaceClick={(faceId) => { setNamingFaceId(faceId); setNameFilter('') }}
            />

            <div className="w-80 bg-gray-900 border-l border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto shrink-0">
                <PhotoActions
                    photo={photo}
                    visualRotation={visualRotation}
                    setVisualRotation={setVisualRotation}
                    isRotating={isRotating}
                    setIsRotating={setIsRotating}
                    onClose={onClose}
                />
                <FaceOverlay
                    photo={photo}
                    faces={faces}
                    showFaceBoxes={showFaceBoxes}
                    setShowFaceBoxes={setShowFaceBoxes}
                    showUnnamedFaces={showUnnamedFaces}
                    setShowUnnamedFaces={setShowUnnamedFaces}
                    namingFaceId={namingFaceId}
                    setNamingFaceId={setNamingFaceId}
                    nameFilter={nameFilter}
                    setNameFilter={setNameFilter}
                    isScanning={isScanning}
                    setIsScanning={setIsScanning}
                    onFacesChanged={fetchTags}
                    onPersonClick={handlePersonClick}
                />
                <PhotoMetadata
                    photo={photo}
                    metadata={metadata}
                    tags={tags}
                    newTag={newTag}
                    setNewTag={setNewTag}
                    isScanning={isScanning}
                    setIsScanning={setIsScanning}
                    onGoToFolder={handleGoToFolder}
                    onTagsChanged={fetchTags}
                />
            </div>
        </div>,
        document.body
    )
}
