import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { PlusIcon } from '@radix-ui/react-icons'
import { useCompositor } from '../hooks/useCompositor'
import { LayerSpec } from '../types/compositor'
import LayerRow from '../components/LayerRow'
import LibraryPhotoPickerModal from '../components/LibraryPhotoPickerModal'
import AdjustmentsPanel from '../components/AdjustmentsPanel'
import type { AdjustmentParams, AdjustmentScope } from '../types/adjustments'
import { toSnakeAdjustParams } from '../types/adjustments'

// Max longest side for encoding source images — keeps IPC payload manageable
const MAX_ENCODE_PX = 2048

// ---------------------------------------------------------------------------
// Helper: load an image file from disk and encode it as a capped base64 PNG
// ---------------------------------------------------------------------------

async function encodeImageFile(filePath: string): Promise<{ b64: string; width: number; height: number }> {
    // @ts-ignore
    const buf: ArrayBuffer = await window.ipcRenderer.invoke('read-file-buffer', filePath)
    const blob = new Blob([buf])
    const url = URL.createObjectURL(blob)

    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const longestSide = Math.max(img.naturalWidth, img.naturalHeight)
            const scale = longestSide > MAX_ENCODE_PX ? MAX_ENCODE_PX / longestSide : 1
            const w = Math.round(img.naturalWidth * scale)
            const h = Math.round(img.naturalHeight * scale)

            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0, w, h)
            URL.revokeObjectURL(url)
            const b64 = canvas.toDataURL('image/png').split(',')[1]
            resolve({ b64, width: w, height: h })
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
        img.src = url
    })
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function Compose() {
    const navigate = useNavigate()
    const location = useLocation()
    const [pickerOpen, setPickerOpen] = useState(false)
    const [loadingLayer, setLoadingLayer] = useState(false)
    const loadingRef = useRef(false)
    const processedNavState = useRef(false)
    // Right-panel tab: 'layers' | 'adjustments'
    const [activeTab, setActiveTab] = useState<'layers' | 'adjustments'>('layers')
    // Active (selected) layer for adjustments
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
    const [adjustBusy, setAdjustBusy] = useState(false)
    const [adjustScope, setAdjustScope] = useState<AdjustmentScope>('global')

    const {
        state,
        updateLayer,
        removeLayer,
        moveLayer,
        bringToFront,
        sendToBack,
        addLayer,
        setCanvasDimensions,
        addFromCreativeTools,
    } = useCompositor()

    // Auto-add layer when navigated here from "Send to Compose"
    useEffect(() => {
        if (processedNavState.current) return
        const navPayload = (location.state as any)?.payload
        if (navPayload?.sourceImageB64 && navPayload?.maskB64) {
            processedNavState.current = true
            addFromCreativeTools({
                sourceImageB64: navPayload.sourceImageB64,
                maskB64: navPayload.maskB64,
                suggestedName: navPayload.suggestedName,
            })
        }
    }, [location.state, addFromCreativeTools])

    // ---------------------------------------------------------------------------
    // dnd-kit sensors
    // ---------------------------------------------------------------------------

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            moveLayer(String(active.id), String(over.id))
        }
    }, [moveLayer])

    // ---------------------------------------------------------------------------
    // Apply adjustments to the active layer
    // ---------------------------------------------------------------------------

    const handleApplyAdjustments = useCallback(async (
        imageB64: string,
        params: AdjustmentParams,
        scope: AdjustmentScope,
    ) => {
        if (!activeLayerId || adjustBusy) return
        const activeLayer = state.layers.find(l => l.id === activeLayerId)
        if (!activeLayer) return

        const maskB64 = scope === 'segment' ? activeLayer.maskB64 : undefined
        if (scope === 'segment' && !maskB64) return

        setAdjustBusy(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:segment:adjust', {
                image_b64: imageB64,
                scope,
                mask_b64: maskB64 || undefined,
                params:   toSnakeAdjustParams(params),
            })
            if (res?.success) {
                updateLayer(activeLayerId, { sourceImageB64: res.result_b64 })
            }
        } catch { /* non-critical */ } finally {
            setAdjustBusy(false)
        }
    }, [activeLayerId, adjustBusy, state.layers, updateLayer])

    // ---------------------------------------------------------------------------
    // Add layer from Library picker
    // ---------------------------------------------------------------------------

    const handleAddFromLibrary = useCallback(async (filePath: string) => {
        if (loadingRef.current) return
        loadingRef.current = true
        setPickerOpen(false)
        setLoadingLayer(true)

        try {
            const { b64, width, height } = await encodeImageFile(filePath)

            // First layer → set canvas dimensions to match
            if (state.layers.length === 0) {
                setCanvasDimensions(width, height)
            }

            const fileName = filePath.split(/[\\/]/).pop() ?? 'Photo'
            addLayer({
                name: fileName,
                sourceImageB64: b64,
                maskB64: '',           // full-image layer — no mask
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                opacity: 1,
                visible: true,
            })
        } catch (e: any) {
            console.warn('[Compose] Failed to encode image:', e)
        } finally {
            loadingRef.current = false
            setLoadingLayer(false)
        }
    }, [state.layers.length, addLayer, setCanvasDimensions])

    // ---------------------------------------------------------------------------
    // Layer sorted by zIndex descending for display (top of stack = first in list)
    // ---------------------------------------------------------------------------

    const sortedLayers = [...state.layers].sort((a, b) => b.zIndex - a.zIndex)
    const itemIds = sortedLayers.map(l => l.id)

    const backgroundLayer = state.layers.reduce<LayerSpec | null>((pick, l) => {
        if (!pick || l.zIndex < pick.zIndex) return l
        return pick
    }, null)

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div className="h-full flex flex-col bg-gray-900 text-gray-100 overflow-hidden">

            {/* Header */}
            <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-700 flex-shrink-0">
                <h1 className="text-lg font-semibold text-white">Compositing Workspace</h1>
                <span className="text-xs text-gray-500">
                    Canvas {state.canvasWidth} × {state.canvasHeight}px
                </span>
                <button
                    onClick={() => navigate('/create')}
                    className="ml-auto text-xs text-gray-400 hover:text-white transition-colors"
                >
                    ← Creative Tools
                </button>
            </div>

            {/* Body: canvas (left 65%) + layers panel (right 35%) */}
            <div className="flex-1 flex min-h-0 overflow-hidden">

                {/* Canvas preview */}
                <div className="flex-[3] flex flex-col min-h-0 border-r border-gray-700">
                    <div className="flex-1 flex items-center justify-center bg-gray-950 relative overflow-hidden">

                        {state.isCompositing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                                <span className="text-white text-sm">Compositing…</span>
                            </div>
                        )}

                        {state.resultB64 ? (
                            <div
                                className="flex-1 flex items-center justify-center w-full h-full p-4"
                                style={{
                                    backgroundImage: 'repeating-conic-gradient(#374151 0% 25%, #1f2937 0% 50%)',
                                    backgroundSize: '20px 20px',
                                }}
                            >
                                <img
                                    src={`data:image/png;base64,${state.resultB64}`}
                                    alt="Composition preview"
                                    className="max-w-full max-h-full object-contain shadow-2xl"
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3 text-gray-600">
                                <div className="text-5xl">🎨</div>
                                <p className="text-sm">Add a layer to begin compositing</p>
                                <button
                                    onClick={() => setPickerOpen(true)}
                                    className="mt-2 flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    Add from Library
                                </button>
                            </div>
                        )}

                        {state.error && (
                            <div className="absolute bottom-4 left-4 right-4 px-3 py-2 rounded-md bg-red-900/80 border border-red-700 text-red-300 text-sm">
                                {state.error}
                            </div>
                        )}
                    </div>

                    {/* Canvas footer actions */}
                    {state.resultB64 && (
                        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-700 bg-gray-800/60 flex-shrink-0">
                            <a
                                href={`data:image/png;base64,${state.resultB64}`}
                                download="composition.png"
                                className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                            >
                                ↓ Download PNG
                            </a>
                            <button
                                onClick={async () => {
                                    try {
                                        const blob = await fetch(`data:image/png;base64,${state.resultB64}`).then(r => r.blob())
                                        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                                    } catch { /* non-critical */ }
                                }}
                                className="px-3 py-1.5 rounded-md text-sm bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                            >
                                Copy to Clipboard
                            </button>
                        </div>
                    )}
                </div>

                {/* Right panel: Layers + Adjustments tabs */}
                <div className="flex-[2] flex flex-col min-h-0 min-w-[280px] max-w-[360px]">

                    {/* Tab bar */}
                    <div className="flex border-b border-gray-700 bg-gray-800/60 flex-shrink-0">
                        {(['layers', 'adjustments'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                                    activeTab === tab
                                        ? 'text-indigo-400 border-b-2 border-indigo-500'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                {tab === 'layers' ? `Layers (${state.layers.length})` : 'Adjustments'}
                            </button>
                        ))}
                        {activeTab === 'layers' && (
                            <button
                                onClick={() => setPickerOpen(true)}
                                disabled={loadingLayer}
                                className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0"
                                aria-label="Add layer from library"
                            >
                                <PlusIcon className="w-3.5 h-3.5" />
                                {loadingLayer ? '…' : 'Add'}
                            </button>
                        )}
                    </div>

                    {/* Layers tab */}
                    {activeTab === 'layers' && (
                        <>
                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                {state.layers.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
                                        <div className="text-3xl">📋</div>
                                        <p className="text-xs text-center">
                                            No layers yet.<br />Pick a photo from Library or send a segment from Creative Tools.
                                        </p>
                                    </div>
                                ) : (
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={handleDragEnd}
                                    >
                                        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                                            {sortedLayers.map(layer => (
                                                <LayerRow
                                                    key={layer.id}
                                                    layer={layer}
                                                    isBackground={layer.id === backgroundLayer?.id}
                                                    isActive={layer.id === activeLayerId}
                                                    onSelect={() => setActiveLayerId(layer.id)}
                                                    onUpdate={patch => updateLayer(layer.id, patch)}
                                                    onRemove={() => removeLayer(layer.id)}
                                                    onBringToFront={() => bringToFront(layer.id)}
                                                    onSendToBack={() => sendToBack(layer.id)}
                                                />
                                            ))}
                                        </SortableContext>
                                    </DndContext>
                                )}
                            </div>
                            {state.layers.length > 0 && (
                                <div className="px-4 py-2 border-t border-gray-700 flex-shrink-0">
                                    <p className="text-xs text-gray-600">
                                        Higher layers render on top · drag to reorder · click to select for adjustments
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    {/* Adjustments tab */}
                    {activeTab === 'adjustments' && (() => {
                        const activeLayer = state.layers.find(l => l.id === activeLayerId) ?? null
                        return (
                            <div className="flex-1 overflow-y-auto">
                                {!activeLayerId ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600 px-4">
                                        <p className="text-xs text-center">
                                            Select a layer in the Layers tab to apply adjustments.
                                        </p>
                                    </div>
                                ) : (
                                    <AdjustmentsPanel
                                        imageB64={activeLayer?.sourceImageB64 ?? null}
                                        hasMask={!!(activeLayer?.maskB64)}
                                        scope={adjustScope}
                                        onScopeChange={setAdjustScope}
                                        busy={adjustBusy}
                                        onApply={handleApplyAdjustments}
                                    />
                                )}
                            </div>
                        )
                    })()}
                </div>
            </div>

            <LibraryPhotoPickerModal
                open={pickerOpen}
                onSelect={handleAddFromLibrary}
                onClose={() => setPickerOpen(false)}
            />
        </div>
    )
}
