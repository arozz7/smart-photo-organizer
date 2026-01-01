
import React, { useState } from 'react';

interface FaceThumbnailProps {
    src: string;
    box?: { x: number; y: number; width: number; height: number; }; // Pixel coordinates relative to the image source
    originalImageWidth?: number; // The width of the original image the box coords correspond to
    alt?: string;
    className?: string;
    useServerCrop?: boolean; // If true, treats src as pre-cropped (no CSS crop), but fallbackSrc as needing CSS crop
}

const FaceThumbnail = React.memo<FaceThumbnailProps & { fallbackSrc?: string }>(function FaceThumbnail({ src, fallbackSrc, box, originalImageWidth, alt, className, useServerCrop }: FaceThumbnailProps & { fallbackSrc?: string }) {
    const [style, setStyle] = useState<React.CSSProperties>({
        opacity: 0, // Hide until loaded and positioned
        transition: 'opacity 0.2s',
        width: '100%',
        height: '100%',
        objectFit: 'cover' // Default fallback
    });

    // Fallback state
    const [currentSrc, setCurrentSrc] = useState(src);
    const [hasRetried, setHasRetried] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Update src if prop changes (reset retry)
    if (src !== currentSrc) {
        setCurrentSrc(src);
        setHasRetried(false);
        setIsLoading(true);
        setStyle(prev => ({ ...prev, opacity: 0 }));
    }

    const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        setIsLoading(false);

        // If using fallback, we assume it's NOT server cropped (it's the full thumbnail)
        const isServerCropped = useServerCrop && !hasRetried;

        if (!box || isServerCropped) {
            // No box, just show full image (or server crop)
            setStyle({ opacity: 1, width: '100%', height: '100%', objectFit: 'cover' });
            return;
        }

        const img = e.currentTarget;
        const naturalW = img.naturalWidth;

        if (!naturalW) return;

        // Calculate Scale Factor if using a preview (smaller/larger than original)
        let scale = 1.0;

        // Always calculate scale if we have original dimensions and current != original
        if (originalImageWidth && originalImageWidth > 0 && originalImageWidth !== naturalW) {
            scale = naturalW / originalImageWidth;
        }

        // Apply scale to box coordinates
        const rectW = box.width * scale;
        const rectX = box.x * scale;
        const rectY = box.y * scale;

        // 2. Calculate Scale: Container Width (100%) matches Target Width
        const newWidthPct = (naturalW / rectW) * 100;

        // 3. Calculate Offsets
        const newMarginLeft = -(rectX / rectW) * 100;
        const newMarginTop = -(rectY / rectW) * 100;

        setStyle({
            opacity: 1,
            display: 'block',
            maxWidth: 'none',
            width: `${newWidthPct}%`,
            marginLeft: `${newMarginLeft}%`,
            marginTop: `${newMarginTop}%`,
            height: 'auto'
        });
    };

    // Safety check for empty paths
    // DEBUG: Check params
    if (!originalImageWidth) console.warn('[FaceThumbnail] Missing originalWidth for', src);

    if (!src || src === 'local-resource://' || src.startsWith('local-resource://?')) {
        return <div className={`bg-gray-800 flex items-center justify-center ${className || ''}`}><span className="text-gray-600 text-[10px]">No Image</span></div>;
    }

    return (
        <div className={`overflow-hidden relative bg-gray-900 ${className || ''}`}>
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800 animate-pulse z-10">
                    <svg className="w-5 h-5 text-gray-700 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            )}
            <img
                src={(() => {
                    if (hasRetried && fallbackSrc) return fallbackSrc;

                    const separator = src.includes('?') ? '&' : '?';
                    let finalSrc = `${src}${separator}silent_404=true`;

                    if (originalImageWidth) {
                        finalSrc += `&originalWidth=${originalImageWidth}`;
                    }

                    if (useServerCrop && box) {
                        finalSrc += `&box=${box.x},${box.y},${box.width},${box.height}`;
                        // Request HQ if it's likely a RAW file or high-detail needed
                        finalSrc += `&hq=true&width=${Math.round(box.width)}`; // Request closer to original resolution or valid thumb size?
                        // Actually, 'width' in protocol is "resize to this".
                        // If we want a thumbnail, we should ask for a reasonable size (e.g. 150) to prompt Python to downscale AFTER crop.
                        // But wait, if we ask for 150, Python will crop then resize to 150.
                        // That's what we want for a thumbnail. The 'box.width' might be 30px or 300px.
                        // Let's cap it at 300 for thumbnails to ensure quality but save bandwidth.
                        finalSrc += `&width=300`;
                    }

                    return finalSrc;
                })()}
                alt={alt || "face"}
                onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth === 1 && img.naturalHeight === 1) {
                        if (fallbackSrc && !hasRetried) {
                            setHasRetried(true);
                            // Keep Loading true until fallback loads
                            return;
                        }
                        setIsLoading(false);
                        setStyle({ ...style, opacity: 1, border: '2px solid red' });
                        return;
                    }
                    handleLoad(e);
                }}
                onError={(_e) => {
                    if (fallbackSrc && !hasRetried) {
                        setHasRetried(true);
                        return;
                    }
                    setIsLoading(false);
                    console.error('[FaceThumbnail] Failed to load:', src);
                    if (hasRetried) {
                        console.error('[FaceThumbnail] Fallback also failed:', fallbackSrc);
                    }
                    setStyle({ ...style, opacity: 1, border: '2px solid red' });
                }}
                style={style}
            />
        </div>
    );
});

export default FaceThumbnail;

