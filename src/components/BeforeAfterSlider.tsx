import { useState, useRef, MouseEvent, TouchEvent } from 'react';

interface BeforeAfterSliderProps {
    originalSrc: string;
    enhancedSrc: string;
    className?: string;
}

export default function BeforeAfterSlider({ originalSrc, enhancedSrc, className = '' }: BeforeAfterSliderProps) {
    const [sliderPos, setSliderPos] = useState(50); // percentage
    const containerRef = useRef<HTMLDivElement>(null);

    const handleMove = (clientX: number) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        setSliderPos((x / rect.width) * 100);
    };

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full overflow-hidden select-none cursor-ew-resize ${className}`}
            onMouseMove={onMouseMove}
            onTouchMove={onTouchMove}
        >
            {/* Enhanced Image (Background/Underneath) - visible on right side */}
            <img
                src={enhancedSrc}
                alt="Enhanced"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
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
                        width: containerRef.current ? containerRef.current.clientWidth : '100%'
                    }}
                />
            </div>

            {/* Slider Handle */}
            <div
                className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-[0_0_10px_rgba(0,0,0,0.5)]"
                style={{ left: `${sliderPos}%` }}
            >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
                    <div className="flex gap-1">
                        <div className="w-0.5 h-3 bg-gray-400"></div>
                        <div className="w-0.5 h-3 bg-gray-400"></div>
                    </div>
                </div>
            </div>

            {/* Labels */}
            <div className="absolute bottom-4 left-4 bg-black/50 text-white px-2 py-1 rounded text-xs pointer-events-none">Original</div>
            <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-xs pointer-events-none">Enhanced</div>
        </div>
    );
}
