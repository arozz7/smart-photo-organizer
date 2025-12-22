
import { useState } from 'react';

interface FaceThumbnailProps {
    src: string;
    box?: { x: number; y: number; width: number; height: number; }; // Pixel coordinates relative to the image source
    originalImageWidth?: number; // The width of the original image the box coords correspond to
    alt?: string;
    className?: string;
}

export default function FaceThumbnail({ src, fallbackSrc, box, originalImageWidth, alt, className }: FaceThumbnailProps & { fallbackSrc?: string }) {
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

    return (
        <div className={`overflow-hidden relative ${className || ''}`}>
            <img
                src={hasRetried ? (fallbackSrc || src) : src}
                alt={alt || "face"}
                onLoad={handleLoad}
                onError={(e) => {
                    if (fallbackSrc && !hasRetried) {
                        // console.debug(`[FaceThumbnail] Primary failed, retrying fallback. Primary: ${src}`);
                        setHasRetried(true);
                        // Trigger re-render with fallback logic
                        return;
                    }
                    console.error('[FaceThumbnail] Failed to load:', src);
                    if (hasRetried) {
                        console.error('[FaceThumbnail] Fallback also failed (or was invalid):', fallbackSrc);
                    }
                    // Make it visible so we see it failed
                    setStyle({ ...style, opacity: 1, border: '2px solid red' });
                }}
                style={style}
            />
        </div>
    );
}

export function FaceDebugOverlay({ src, box, onClose }: { src: string, box?: { x: number, y: number, width: number, height: number }, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-8" onClick={onClose}>
            <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
                <img src={src} className="max-w-full max-h-[90vh] object-contain" />
                {box && (
                    <div
                        className="absolute border-2 border-red-500 bg-red-500/20"
                        style={{
                            // We need to map the "natural" box coordinates to the "displayed" image coordinates.
                            // This is tricky because object-contain scales the image.
                            // Instead of complex math, we can just overlay a 100% width/height container that matches the image aspect ratio?
                            // EASIER: Just use the natural dimensions if possible, or use a helper.
                            // Actually, if we just put this div inside a relative container that wraps the img, and the img is block,
                            // we'd need to know the scale.
                            // ALTERNATIVE: Use an SVG overlay which scales with the image if viewBox is set to natural dimensions.
                            // Let's try SVG.
                        }}
                    >
                        {/* Replaced by SVG approach below */}
                    </div>
                )}
                {/* SVG Overlay */}
                <div className="absolute inset-0 pointer-events-none">
                    {/* We can't easily sync exact pixels without knowing rendered size vs natural size. 
                         However, if we put the img and svg in a grid, they overlap perfectly.
                         But we need natural dimensions for viewBox.
                         Let's load natural dimensions first? Or just act simple:
                         Use CSS aspect-ratio?
                         
                         Let's use a simple trick: render the image, get its bounds on load?
                         
                         A robust way:
                         Wrap img in a div `relative inline-block`.
                         The img dictates the size.
                         The box is `absolute`.
                         Box left/top/width/height are percentages: (val / naturalDim) * 100 %.
                         We don't know naturalDim until load.
                    */}
                    <DebugBox src={src} box={box} />
                </div>
            </div>
            <button className="absolute top-4 right-4 text-white hover:text-red-400 p-2" onClick={onClose}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white bg-black/50 px-4 py-2 rounded">
                Box: {box ? `x:${Math.round(box.x)} y:${Math.round(box.y)} w:${Math.round(box.width)} h:${Math.round(box.height)}` : 'No Box'}
            </div>
        </div>
    );
}

function DebugBox({ src, box }: { src: string, box: any }) {
    const [dims, setDims] = useState<{ w: number, h: number } | null>(null);

    const onImgLoad = (e: any) => {
        setDims({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    };

    // We render a hidden image to get dims, then render the box? 
    // No, we are inside a container that ALREADY has the image (in parent). 
    // But parent image might be scaled.
    // Let's just create a new hidden img here to get natural dims reliably.

    return (
        <>
            <img src={src} className="absolute inset-0 w-full h-full opacity-0 pointer-events-none" onLoad={onImgLoad} />
            {dims && box && (
                <div
                    className="absolute border-2 border-red-500 bg-red-500/30 font-bold text-xs text-red-100 flex items-start justify-start pl-1 pt-1"
                    style={{
                        left: `${(box.x / dims.w) * 100}%`,
                        top: `${(box.y / dims.h) * 100}%`,
                        width: `${(box.width / dims.w) * 100}%`,
                        height: `${(box.height / dims.h) * 100}%`,
                    }}
                >
                    FACE
                </div>
            )}
        </>
    );
}
