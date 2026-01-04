import { memo } from 'react'
import FaceThumbnail from './FaceThumbnail'
import { useScan } from '../context/ScanContext'

interface PersonFaceItemProps {
    face: any
    isSelected: boolean
    toggleSelection: (id: number) => void
    isCover?: boolean
    onSetCover?: (id: number) => void
}

const PersonFaceItem = memo(({ face, isSelected, toggleSelection, isCover, onSetCover }: PersonFaceItemProps) => {
    const { viewPhoto } = useScan();

    return (
        <>
            <div
                className={`relative group aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${isSelected ? 'border-blue-500 scale-95' : isCover ? 'border-yellow-500/50' : 'border-transparent hover:border-gray-600'
                    }`}
                onClick={() => toggleSelection(face.id)}
            >
                <FaceThumbnail
                    // optimization: Use original file path + server crop to get high quality face from RAW
                    src={`local-resource://${encodeURIComponent(face.file_path)}`}
                    fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    box={face.box}
                    originalImageWidth={face.width}
                    useServerCrop={true}
                    className="w-full h-full pointer-events-none"
                />

                {isCover && (
                    <div className="absolute top-2 left-2 bg-yellow-500/90 rounded-full p-1 shadow-lg z-10" title="Current Cover">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-black" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                    </div>
                )}

                {isSelected && (
                    <div className="absolute top-2 right-2 bg-blue-500 rounded-full p-1 z-10">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                    </div>
                )}

                {/* Data Quality & Confidence Indicators */}
                {!isSelected && (
                    <div className="absolute top-2 right-2 flex flex-col gap-1 items-end z-10 pointer-events-none">
                        {/* Low Recognition Confidence (Review Tier) */}
                        {face.match_distance !== undefined && face.match_distance > 0.4 && (
                            <div className="bg-orange-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm backdrop-blur-sm" title={`Weak Match (${Math.round((1 / (1 + face.match_distance)) * 100)}%)`}>
                                ?
                            </div>
                        )}

                        {/* Low Quality / Side Profile */}
                        {face.face_quality !== undefined && face.face_quality < 0.5 && (
                            <div className="bg-gray-700/80 text-white rounded p-0.5 shadow-sm backdrop-blur-sm" title="Low Quality / Side Profile">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                </svg>
                            </div>
                        )}
                    </div>
                )}

                {/* Actions Bar */}
                <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all z-40 transform translate-y-2 group-hover:translate-y-0">
                    {onSetCover && !isCover && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onSetCover(face.id);
                            }}
                            className="bg-black/50 hover:bg-yellow-600 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm"
                            title="Set as Cover Photo"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            viewPhoto(face.photo_id);
                        }}
                        className="bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm"
                        title="View Original Photo"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>
        </>
    )
})

export default PersonFaceItem
