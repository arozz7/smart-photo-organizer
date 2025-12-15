import { memo, useState } from 'react'
import FaceThumbnail, { FaceDebugOverlay } from './FaceThumbnail'

interface PersonFaceItemProps {
    face: any
    isSelected: boolean
    toggleSelection: (id: number) => void
}

const PersonFaceItem = memo(({ face, isSelected, toggleSelection }: PersonFaceItemProps) => {
    const [showDebug, setShowDebug] = useState(false);

    return (
        <>
            <div
                className={`relative group aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${isSelected ? 'border-blue-500 scale-95' : 'border-transparent hover:border-gray-600'
                    }`}
                onClick={() => toggleSelection(face.id)}
            >
                <FaceThumbnail
                    src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    box={face.box}
                    originalImageWidth={face.width}
                    className="w-full h-full pointer-events-none"
                />

                {/* Debug Button - Solid Red, Top Left */}
                <button
                    className="absolute top-2 left-2 p-1.5 bg-red-600 text-white rounded-full z-40 shadow-lg hover:bg-red-700 transition-all"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowDebug(true);
                    }}
                    title="Debug Face Crop"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                </button>

                {isSelected && (
                    <div className="absolute top-2 right-2 bg-blue-500 rounded-full p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                    </div>
                )}
            </div>
            {showDebug && (
                <FaceDebugOverlay
                    src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    box={face.box}
                    onClose={() => setShowDebug(false)}
                />
            )}
        </>
    )
})

export default PersonFaceItem
