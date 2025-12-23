import { memo } from 'react'
import FaceThumbnail from './FaceThumbnail'
import { useScan } from '../context/ScanContext'

interface PersonFaceItemProps {
    face: any
    isSelected: boolean
    toggleSelection: (id: number) => void
}

const PersonFaceItem = memo(({ face, isSelected, toggleSelection }: PersonFaceItemProps) => {
    const { viewPhoto } = useScan();

    return (
        <>
            <div
                className={`relative group aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${isSelected ? 'border-blue-500 scale-95' : 'border-transparent hover:border-gray-600'
                    }`}
                onClick={() => toggleSelection(face.id)}
            >
                <FaceThumbnail
                    src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    fallbackSrc={`local-resource://${encodeURIComponent(face.file_path)}`}
                    box={face.box}
                    originalImageWidth={face.width}
                    className="w-full h-full pointer-events-none"
                />


                {isSelected && (
                    <div className="absolute top-2 right-2 bg-blue-500 rounded-full p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                    </div>
                )}

                {/* View Original Button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        viewPhoto(face.photo_id);
                    }}
                    className="absolute bottom-2 right-2 bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-all z-40 shadow-lg"
                    title="View Original Photo"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
        </>
    )
})

export default PersonFaceItem
