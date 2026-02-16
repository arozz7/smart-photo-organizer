import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragHandleDots2Icon } from '@radix-ui/react-icons';
import { ReactNode, useState, useRef, useCallback } from 'react';

interface DraggableWidgetProps {
    id: string;
    children: ReactNode;
    colSpan: string;
    onResize?: (id: string, size: '1x1' | '2x1' | '2x2') => void;
    resizable?: boolean;
}

const COL_SNAP_BREAKPOINTS = [
    { cols: 4, size: '1x1' as const, minWidth: 0 },
    { cols: 8, size: '2x1' as const, minWidth: 400 },
    { cols: 12, size: '2x2' as const, minWidth: 700 },
];

export default function DraggableWidget({ id, children, colSpan, onResize, resizable = false }: DraggableWidgetProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const [isResizing, setIsResizing] = useState(false);
    const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : undefined,
    };

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!containerRef.current || !onResize) return;

        const startX = e.clientX;
        const startWidth = containerRef.current.getBoundingClientRect().width;
        resizeRef.current = { startX, startWidth };
        setIsResizing(true);

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!resizeRef.current) return;
            const delta = moveEvent.clientX - resizeRef.current.startX;
            const newWidth = resizeRef.current.startWidth + delta;

            // Determine closest snap size
            let bestSize: '1x1' | '2x1' | '2x2' = '1x1';
            for (const bp of COL_SNAP_BREAKPOINTS) {
                if (newWidth >= bp.minWidth) {
                    bestSize = bp.size;
                }
            }

            // Visual feedback via temporary class
            if (containerRef.current) {
                containerRef.current.setAttribute('data-resize-preview', bestSize);
            }
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
            if (!resizeRef.current) return;
            const delta = upEvent.clientX - resizeRef.current.startX;
            const newWidth = resizeRef.current.startWidth + delta;

            let bestSize: '1x1' | '2x1' | '2x2' = '1x1';
            for (const bp of COL_SNAP_BREAKPOINTS) {
                if (newWidth >= bp.minWidth) {
                    bestSize = bp.size;
                }
            }

            onResize(id, bestSize);
            setIsResizing(false);
            resizeRef.current = null;
            if (containerRef.current) {
                containerRef.current.removeAttribute('data-resize-preview');
            }

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [id, onResize]);

    return (
        <div
            ref={(node) => {
                setNodeRef(node);
                containerRef.current = node;
            }}
            style={style}
            className={`${colSpan} relative group ${isDragging ? 'ring-2 ring-indigo-500 rounded-lg' : ''} ${isResizing ? 'ring-2 ring-amber-400 rounded-lg' : ''}`}
        >
            {/* Drag handle */}
            <button
                {...attributes}
                {...listeners}
                className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-gray-800/80 text-gray-500 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-gray-700 transition-all cursor-grab active:cursor-grabbing"
                aria-label={`Drag to reorder ${id} widget`}
                title="Drag to reorder"
            >
                <DragHandleDots2Icon className="w-4 h-4" />
            </button>

            {children}

            {/* Resize handle */}
            {resizable && onResize && (
                <div
                    onMouseDown={handleResizeStart}
                    className="absolute bottom-1 right-1 z-10 w-4 h-4 opacity-0 group-hover:opacity-100 cursor-se-resize transition-opacity"
                    title="Drag to resize"
                >
                    <svg viewBox="0 0 16 16" fill="none" className="w-full h-full text-gray-500 hover:text-white transition-colors">
                        <path d="M14 2L2 14M14 6L6 14M14 10L10 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </div>
            )}
        </div>
    );
}
