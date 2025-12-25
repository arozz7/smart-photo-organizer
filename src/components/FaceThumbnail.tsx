
import React, { useState } from 'react';

interface FaceThumbnailProps {
    src: string;
    box?: { x: number; y: number; width: number; height: number; }; // Pixel coordinates relative to the image source
    originalImageWidth?: number; // The width of the original image the box coords correspond to
    alt?: string;
    className?: string;
}

const FaceThumbnail = React.memo<FaceThumbnailProps & { fallbackSrc?: string }>(function FaceThumbnail({ src, fallbackSrc, box, originalImageWidth, alt, className }: FaceThumbnailProps & { fallbackSrc?: string }) {
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

    // Update src if prop changes (reset retry)
    if (src !== currentSrc) {
        setCurrentSrc(src);
        setHasRetried(false);
    }

    const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        if (!box) {
            // No box, just show full image
            setStyle({ opacity: 1, width: '100%', height: '100%', objectFit: 'cover' });
            return;
        }

        const img = e.currentTarget;
        const naturalW = img.naturalWidth;
        // setNaturalWidth(naturalW); // Removed debug state
        // const naturalH = img.naturalHeight;

        if (!naturalW) return;

        // Calculate Scale Factor if using a preview (smaller/larger than original)
        let scale = 1.0;

        // If we fell back to the original image, force scale to 1.0 (assuming box is based on original)
        const isUsingFallback = hasRetried && fallbackSrc;

        if (!isUsingFallback && originalImageWidth && originalImageWidth > 0 && originalImageWidth !== naturalW) {
            scale = naturalW / originalImageWidth;
            // console.log(`[FaceThumbnail] Rescaling box: Original=${originalImageWidth}, Actual=${naturalW}, Scale=${scale}`);
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
    if (!src || src === 'local-resource://' || src.startsWith('local-resource://?')) {
        return <div className={`bg-gray-800 flex items-center justify-center ${className || ''}`}><span className="text-gray-600 text-[10px]">No Image</span></div>;
    }

    return (
        <div className={`overflow-hidden relative ${className || ''}`}>
            <img
                src={hasRetried ? (fallbackSrc || src) : `${src}?silent_404=true`}
                alt={alt || "face"}
                onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth === 1 && img.naturalHeight === 1) {
                        if (fallbackSrc && !hasRetried) {
                            setHasRetried(true);
                            return;
                        }
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

