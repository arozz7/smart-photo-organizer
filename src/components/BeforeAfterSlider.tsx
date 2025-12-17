import { useState, useRef, MouseEvent, TouchEvent } from 'react';

interface BeforeAfterSliderProps {
    originalSrc: string;
    enhancedSrc: string;
    className?: string;
}

export default function BeforeAfterSlider({ originalSrc, enhancedSrc, className = '' }: BeforeAfterSliderProps) {
    const [sliderPos, setSliderPos] = useState(50); // percentage
    const [isPaused, setIsPaused] = useState(false);

    // Zoom & Pan State
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const containerRef = useRef<HTMLDivElement>(null);

    const handleMove = (clientX: number) => {
        // Disable slider move if we are zoomed in (panning mode) or paused
        if (isPaused || scale > 1 || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        setSliderPos((x / rect.width) * 100);
    };

    const handleInteraction = (clientX: number) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        setSliderPos((x / rect.width) * 100);
    }

    // Mouse Event Wrappers
    const onMouseMove = (e: MouseEvent) => {
        if (scale > 1 && isDragging) {
            // Pan logic
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setDragStart({ x: e.clientX, y: e.clientY });
        } else {
            handleMove(e.clientX);
        }
    };

    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);

    // Zoom Logic (Wheel)
    const onWheel = (e: React.WheelEvent) => {
        // e.stopPropagation(); 
        // e.preventDefault(); // React synthetic events can't prevent default passive?

        const delta = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(1, scale + delta), 8); // Clamp 1x - 8x

        setScale(newScale);

        if (newScale === 1) {
            setTranslate({ x: 0, y: 0 }); // Reset pan on reset zoom
        }
    };

    // Drag Start
    const onMouseDown = (e: MouseEvent) => {
        if (scale > 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    }

    const onMouseUp = () => {
        setIsDragging(false);
    }

    // Toggle pause on click (Only if not zoomed/dragging)
    const handleClick = (e: MouseEvent) => {
        if (scale > 1) return; // Ignore clicks if zoomed (conflict with drag?)

        setIsPaused(!isPaused);
        handleInteraction(e.clientX);
    };

    // Reset Zoom Button
    const resetZoom = (e: MouseEvent) => {
        e.stopPropagation();
        setScale(1);
        setTranslate({ x: 0, y: 0 });
    }

    const transformStyle = {
        transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
    };

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full overflow-hidden select-none ${scale > 1 ? 'cursor-move' : 'cursor-ew-resize'} ${className}`}
            onMouseMove={onMouseMove}
            onTouchMove={onTouchMove}
            onClick={handleClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
        >
            {/* Reset Zoom Button */}
            {scale > 1 && (
                <button
                    onClick={resetZoom}
                    className="absolute top-4 right-4 z-20 bg-black/60 text-white px-3 py-1 rounded-full text-sm hover:bg-black/80 transition-colors"
                >
                    Reset Zoom ({scale.toFixed(1)}x)
                </button>
            )}
            {/* Enhanced Image (Background/Underneath) - visible on right side */}
            <img
                src={enhancedSrc}
                alt="Enhanced"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none origin-center"
                style={transformStyle}
            />

            {/* Original Image (Masked Overlay) - visible on left side */}
            <div
                className="absolute inset-0 overflow-hidden pointer-events-none border-r-2 border-white shadow-lg"
                style={{ width: `${sliderPos}%` }}
            >
                <img
                    src={originalSrc}
                    alt="Original"
                    className="absolute top-0 left-0 max-w-none h-full object-contain"
                    // We need to ensure the image size/position matches the background one perfectly.
                    // css 'object-contain' might make them drift if aspect ratios differ?
                    // Assuming same aspect ratio helps.
                    // To ensure alignment with object-contain, we might need JS logic or just use object-cover if we force container ratio.
                    // For photo tools, 'object-contain' is safer but harder to align two layers.
                    // simpler trick: use style width/height 100% on both?
                    style={{
                        width: containerRef.current ? containerRef.current.clientWidth : '100%',
                        ...transformStyle
                    }}
                />
            </div>

            {/* Slider Handle */}
            <div
                className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-[0_0_10px_rgba(0,0,0,0.5)]"
                style={{ left: `${sliderPos}%` }}
            >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
                    <div className="flex gap-1 justify-center items-center h-full">
                        {/* Icon changes based on state */}
                        {isPaused ? (
                            <svg width="10" height="10" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-600"><path d="M2.5 7.5L5.5 10.5L12.5 3.5" stroke="currentColor" stroke-linecap="square" /></svg>
                        ) : (
                            <>
                                <div className="w-0.5 h-3 bg-gray-400"></div>
                                <div className="w-0.5 h-3 bg-gray-400"></div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Labels */}
            <div className="absolute bottom-4 left-4 bg-black/50 text-white px-2 py-1 rounded text-xs pointer-events-none">Original</div>
            <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-xs pointer-events-none">Enhanced</div>
        </div>
    );
}
