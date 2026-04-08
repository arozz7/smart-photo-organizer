import { useState, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    EyeOpenIcon, EyeNoneIcon, TrashIcon, ArrowUpIcon,
    ArrowDownIcon, DragHandleDots2Icon,
} from '@radix-ui/react-icons'
import { LayerSpec } from '../types/compositor'

interface Props {
    layer: LayerSpec
    isBackground: boolean
    onUpdate: (patch: Partial<LayerSpec>) => void
    onRemove: () => void
    onBringToFront: () => void
    onSendToBack: () => void
}

export default function LayerRow({
    layer,
    isBackground,
    onUpdate,
    onRemove,
    onBringToFront,
    onSendToBack,
}: Props) {
    const [editing, setEditing] = useState(false)
    const [draftName, setDraftName] = useState(layer.name)
    const nameInputRef = useRef<HTMLInputElement>(null)

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: layer.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    }

    const handleNameSubmit = () => {
        const trimmed = draftName.trim() || layer.name
        onUpdate({ name: trimmed })
        setEditing(false)
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
                isBackground
                    ? 'bg-gray-800 border-gray-600'
                    : 'bg-gray-750 border-gray-700 hover:border-gray-600'
            }`}
        >
            {/* Drag Handle */}
            <button
                {...attributes}
                {...listeners}
                className="text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
                title="Drag to reorder"
                aria-label="Drag layer to reorder"
            >
                <DragHandleDots2Icon className="w-4 h-4" />
            </button>

            {/* Visibility Toggle */}
            <button
                onClick={() => onUpdate({ visible: !layer.visible })}
                className={`flex-shrink-0 transition-colors ${
                    layer.visible ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-400'
                }`}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
            >
                {layer.visible ? (
                    <EyeOpenIcon className="w-4 h-4" />
                ) : (
                    <EyeNoneIcon className="w-4 h-4" />
                )}
            </button>

            {/* Layer Name */}
            <div className="flex-1 min-w-0">
                {editing ? (
                    <input
                        ref={nameInputRef}
                        type="text"
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                        onBlur={handleNameSubmit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleNameSubmit()
                            if (e.key === 'Escape') { setEditing(false); setDraftName(layer.name) }
                        }}
                        className="w-full bg-gray-900 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                        autoFocus
                        aria-label="Layer name"
                    />
                ) : (
                    <button
                        onClick={() => { setEditing(true); setDraftName(layer.name) }}
                        className="w-full text-left text-xs text-gray-200 truncate hover:text-white transition-colors"
                        title={`Click to rename: ${layer.name}`}
                        aria-label={`Layer name: ${layer.name}. Click to rename.`}
                    >
                        {isBackground && (
                            <span className="text-gray-500 mr-1">[BG]</span>
                        )}
                        {layer.name}
                    </button>
                )}
            </div>

            {/* Opacity */}
            <div className="flex items-center gap-1 flex-shrink-0" title={`Opacity: ${Math.round(layer.opacity * 100)}%`}>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={layer.opacity}
                    onChange={e => onUpdate({ opacity: Number(e.target.value) })}
                    className="w-14 accent-indigo-500"
                    aria-label={`Layer opacity: ${Math.round(layer.opacity * 100)}%`}
                />
                <span className="text-xs text-gray-400 w-7 tabular-nums text-right">
                    {Math.round(layer.opacity * 100)}%
                </span>
            </div>

            {/* Z-order quick actions */}
            <button
                onClick={onBringToFront}
                className="flex-shrink-0 text-gray-500 hover:text-indigo-300 transition-colors"
                title="Bring to front"
                aria-label="Bring layer to front"
            >
                <ArrowUpIcon className="w-3.5 h-3.5" />
            </button>
            <button
                onClick={onSendToBack}
                disabled={isBackground}
                className="flex-shrink-0 text-gray-500 hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Send to back"
                aria-label="Send layer to back"
            >
                <ArrowDownIcon className="w-3.5 h-3.5" />
            </button>

            {/* Delete */}
            <button
                onClick={onRemove}
                disabled={isBackground}
                className="flex-shrink-0 text-gray-600 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title={isBackground ? 'Background layer cannot be deleted' : 'Remove layer'}
                aria-label={isBackground ? 'Background layer cannot be deleted' : 'Remove layer'}
            >
                <TrashIcon className="w-4 h-4" />
            </button>
        </div>
    )
}
