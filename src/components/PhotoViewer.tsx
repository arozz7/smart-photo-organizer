import { useState, useEffect, useRef } from 'react'

interface PhotoViewerProps {
    photo: any
    imagePath: string
    imageRetryCount: number
    setImageRetryCount: (n: number) => void
    setImagePath: (s: string) => void
    visualRotation: number
    faces: any[]
    showFaceBoxes: boolean
    showUnnamedFaces: boolean
    onPrev: () => void
    onNext: () => void
    onFaceClick: (faceId: number) => void
}

export function PhotoViewer({
    photo, imagePath, imageRetryCount, setImageRetryCount, setImagePath,
    visualRotation, faces, showFaceBoxes, showUnnamedFaces,
    onPrev, onNext, onFaceClick
}: PhotoViewerProps) {
    const [imgRect, setImgRect] = useState<{ width: number; height: number; left: number; top: number } | null>(null)
    const [isImageLoaded, setIsImageLoaded] = useState(false)
    const imgRef = useRef<HTMLImageElement>(null)
    const photoAreaRef = useRef<HTMLDivElement>(null)

    const updateImgRect = (img: HTMLImageElement) => {
        const area = photoAreaRef.current
        if (!area) return
        const cw = area.clientWidth
        const ch = area.clientHeight
        const isRotated = (visualRotation / 90) % 2 !== 0
        const maxW = isRotated ? ch : cw
        const maxH = isRotated ? cw : ch
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        if (!iw || !ih) return
        const aspect = iw / ih
        const containerAspect = maxW / maxH
        let renderedW, renderedH
        if (aspect > containerAspect) {
            renderedW = maxW
            renderedH = maxW / aspect
        } else {
            renderedH = maxH
            renderedW = maxH * aspect
        }
        setImgRect({ width: renderedW, height: renderedH, left: 0, top: 0 })
    }

    const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        updateImgRect(e.currentTarget)
        setIsImageLoaded(true)
    }

    useEffect(() => {
        if (imgRef.current) updateImgRect(imgRef.current)
    }, [visualRotation])

    useEffect(() => {
        const handleResize = () => {
            if (imgRef.current) updateImgRect(imgRef.current)
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Reset loaded state when photo changes (component is keyed by photo.id, so this handles remount)
    useEffect(() => {
        setIsImageLoaded(false)
        setImgRect(null)
    }, [photo?.id])

    const ext = photo.file_path.split('.').pop()?.toLowerCase() || ''
    const isWebFriendly = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
    const hasPreview = !!photo.preview_cache_path

    return (
        <div className="flex-1 relative flex items-center justify-center p-4 min-w-0 min-h-0">
            <button
                onClick={onPrev}
                className="absolute left-4 z-10 flex flex-col items-center gap-1 p-3 text-white/50 hover:text-white bg-black/30 hover:bg-black/60 rounded-xl border border-white/5 hover:border-white/20 transition-all backdrop-blur-sm"
                aria-label="Previous photo"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-[10px] font-mono text-white/30">←</span>
            </button>

            <div
                ref={photoAreaRef}
                className="flex-1 bg-black flex items-center justify-center overflow-hidden relative group min-w-0 min-h-0 w-full h-full"
            >
                {!isWebFriendly && !hasPreview ? (
                    <div className="text-gray-400 flex flex-col items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>Preview Unavailable</span>
                        <span className="text-xs text-gray-500">Run 'Scan Folder' to generate previews for RAW files.</span>
                    </div>
                ) : (
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
                            onError={(e) => {
                                console.warn(`[PhotoViewer] Image failed to load (attempt ${imageRetryCount + 1}): ${imagePath}`)
                                if (imageRetryCount < 2) {
                                    console.log(`[PhotoViewer] Retrying image load...`)
                                    setImageRetryCount(imageRetryCount + 1)
                                    setImagePath(`local-resource://${encodeURIComponent(photo.file_path)}?retry=${Date.now()}`)
                                    return
                                }
                                console.error(`[PhotoViewer] All retry attempts failed for:`, {
                                    id: photo.id,
                                    file_path: photo.file_path,
                                    preview_cache_path: photo.preview_cache_path
                                })
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const fallback = target.parentElement?.querySelector('.image-error-fallback')
                                if (fallback) (fallback as HTMLElement).style.display = 'flex'
                            }}
                        />
                        <div className="image-error-fallback hidden text-gray-400 flex-col items-center gap-2 absolute inset-0 justify-center bg-gray-900">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span>Failed to load preview</span>
                            <span className="text-xs text-gray-500">{photo.file_path.split(/[\\/]/).pop()}</span>
                            <span className="text-xs text-gray-600">Try re-scanning the library to regenerate previews</span>
                        </div>

                        {imgRect && (
                            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                                {faces
                                    .filter(f => showFaceBoxes && (showUnnamedFaces || f.person_name))
                                    .map((face) => {
                                        const scaleX = imgRect.width / (photo.width || 1)
                                        const scaleY = imgRect.height / (photo.height || 1)
                                        const { x, y, width, height } = face.box
                                        return (
                                            <div
                                                key={face.id}
                                                onClick={(e) => {
                                                    if (!face.person_name) {
                                                        e.stopPropagation()
                                                        onFaceClick(face.id)
                                                    }
                                                }}
                                                className={`absolute border-2 ${face.person_name
                                                    ? 'border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]'
                                                    : 'border-indigo-500/50 shadow-[0_0_8px_rgba(79,70,229,0.3)] cursor-pointer hover:border-white hover:bg-white/10 pointer-events-auto'
                                                } rounded-sm`}
                                                style={{
                                                    left: x * scaleX,
                                                    top: y * scaleY,
                                                    width: width * scaleX,
                                                    height: height * scaleY
                                                }}
                                                title={face.person_name || 'Click to name'}
                                            >
                                                {face.person_name && (
                                                    <div className="absolute -top-5 left-0 bg-purple-600 text-white text-[9px] px-1 py-0.5 rounded-t whitespace-nowrap font-bold">
                                                        {face.person_name}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                            </div>
                        )}
                    </div>
                )}

                {!isImageLoaded && (isWebFriendly || hasPreview) && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin backdrop-blur-sm"></div>
                            <span className="text-indigo-400 text-sm font-medium bg-black/50 px-3 py-1 rounded-full backdrop-blur-md">Loading Photo...</span>
                        </div>
                    </div>
                )}
            </div>

            <button
                onClick={onNext}
                className="absolute right-4 flex flex-col items-center gap-1 p-3 text-white/50 hover:text-white bg-black/30 hover:bg-black/60 rounded-xl border border-white/5 hover:border-white/20 transition-all backdrop-blur-sm"
                aria-label="Next photo"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-[10px] font-mono text-white/30">→</span>
            </button>
        </div>
    )
}
