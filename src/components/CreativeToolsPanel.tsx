import { useRef, useEffect, useCallback, useState } from 'react'
import { useSegmentation, PromptMode, PointPrompt } from '../hooks/useSegmentation'
import LibraryPhotoPickerModal from './LibraryPhotoPickerModal'
import CreativeOperationsBar from './CreativeOperationsBar'
import {
    CanvasTransform, BoxHandle, DragAction,
    toImageCoords, isInsideImage,
    getBoxHandlePositions, hitTestHandle, hitTestPoint,
    isInsideBox, applyResizeHandle, getCursorForHandle,
} from './canvasHelpers'

const CANVAS_W = 680
const CANVAS_H = 480

const MODE_BUTTONS: { mode: PromptMode; label: string; title: string }[] = [
    { mode: 'box', label: '□ Box', title: 'Drag to draw · handles resize · drag inside moves · Delete clears' },
    { mode: 'points', label: '· Points', title: 'Click = include · Shift+click = exclude · click point = delete · drag point = move' },
    { mode: 'text', label: 'Text', title: 'Describe what to segment — short noun phrases work best (e.g. person · dog · red umbrella)' },
    { mode: 'exemplar', label: '⊡ Exemplar', title: 'Draw a reference box around one instance — SAM 3 finds all similar instances in the photo' },
]

export default function CreativeToolsPanel() {
    const [pickerOpen, setPickerOpen] = useState(false)
    const [cursor, setCursor] = useState('default')
    const [liveBox, setLiveBox] = useState<[number, number, number, number] | null>(null)
    // Exemplar mode: controls whether the next drawn box is a reference or exclusion box
    const [exemplarDrawIsNeg, setExemplarDrawIsNeg] = useState(false)

    const {
        state,
        checkCapabilities,
        loadImage,
        openImageDialog,
        setPromptMode,
        setText,
        addPoint,
        removePoint,
        movePoint,
        setBox,
        setExemplarBox,
        addExemplarNegBox,
        clearExemplarBoxes,
        clearPrompts,
        setSelectedMaskIdx,
        setTextThreshold,
        setMaskThreshold,
        setFeatherRadius,
        setInvertSelection,
        unionAllMasks,
        predict,
        applyOperation,
        reset,
    } = useSegmentation()

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const imageRef = useRef<HTMLImageElement | null>(null)
    const transformRef = useRef<CanvasTransform | null>(null)
    const dragRef = useRef<DragAction>({ type: 'none' })
    const didMoveRef = useRef(false)
    const hoveredHandleRef = useRef<BoxHandle | null>(null)
    const hoveredPointIdxRef = useRef<number | null>(null)
    const movingPointPosRef = useRef<{ x: number; y: number } | null>(null)
    const movingPointIdxRef = useRef<number | null>(null)
    const stateRef = useRef(state)
    useEffect(() => { stateRef.current = state })
    const redrawCanvasRef = useRef<() => void>(() => {})

    useEffect(() => { checkCapabilities() }, [checkCapabilities])
    useEffect(() => {
        if (!state.imagePath) return
        const img = new Image()
        img.onload = () => {
            imageRef.current = img
            redrawCanvasRef.current()
        }
        // @ts-ignore
        img.src = `file://${state.imagePath}`
    }, [state.imagePath])
    useEffect(() => {
        redrawCanvasRef.current()
    }, [state.points, state.box, state.exemplarBox, state.exemplarNegBoxes, liveBox])
    // Delete key clears box in box mode, or all exemplar boxes in exemplar mode
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const s = stateRef.current
            if (e.key === 'Delete') {
                if (s.promptMode === 'box' && s.box) clearPrompts()
                else if (s.promptMode === 'exemplar' && (s.exemplarBox || s.exemplarNegBoxes.length)) clearExemplarBoxes()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [clearPrompts, clearExemplarBoxes])

    // ---------------------------------------------------------------------------
    // Canvas drawing
    // ---------------------------------------------------------------------------

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#1f2937'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const img = imageRef.current
        if (!img) return

        const scale = Math.min(CANVAS_W / img.naturalWidth, CANVAS_H / img.naturalHeight)
        const renderedW = img.naturalWidth * scale
        const renderedH = img.naturalHeight * scale
        const offsetX = (CANVAS_W - renderedW) / 2
        const offsetY = (CANVAS_H - renderedH) / 2

        transformRef.current = { scale, offsetX, offsetY, renderedW, renderedH }
        const t = transformRef.current

        ctx.drawImage(img, offsetX, offsetY, renderedW, renderedH)

        // Box (live during drag or committed)
        const activeBox = liveBox ?? state.box
        if (activeBox) {
            const [x1, y1, x2, y2] = activeBox
            ctx.save()
            ctx.strokeStyle = '#6366f1'
            ctx.lineWidth = 2
            ctx.setLineDash([5, 3])
            ctx.strokeRect(offsetX + x1 * scale, offsetY + y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale)
            ctx.restore()

            // Resize handles — only when committed and not actively dragging
            if (!liveBox && dragRef.current.type === 'none') {
                const handles = getBoxHandlePositions(activeBox, t)
                const hovH = hoveredHandleRef.current
                for (const h of Object.keys(handles) as BoxHandle[]) {
                    const pos = handles[h]
                    ctx.save()
                    ctx.fillStyle = h === hovH ? '#818cf8' : '#ffffff'
                    ctx.strokeStyle = '#6366f1'
                    ctx.lineWidth = 1.5
                    ctx.fillRect(pos.cx - 4, pos.cy - 4, 8, 8)
                    ctx.strokeRect(pos.cx - 4, pos.cy - 4, 8, 8)
                    ctx.restore()
                }
            }
        }

        // Exemplar mode: ref box (green) + neg boxes (red) + live drag preview
        if (state.promptMode === 'exemplar') {
            const drawExemplarBox = (
                box: [number, number, number, number],
                color: string,
                dash: number[] = []
            ) => {
                const [x1, y1, x2, y2] = box
                ctx.save()
                ctx.strokeStyle = color
                ctx.lineWidth = 2
                ctx.setLineDash(dash)
                ctx.strokeRect(offsetX + x1 * scale, offsetY + y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale)
                ctx.restore()
            }
            if (liveBox) drawExemplarBox(liveBox, '#6366f1', [5, 3])
            if (state.exemplarBox) drawExemplarBox(state.exemplarBox, '#22c55e')
            for (const neg of state.exemplarNegBoxes) drawExemplarBox(neg, '#ef4444')
        }

        // Points
        const movingIdx = movingPointIdxRef.current
        for (let i = 0; i < state.points.length; i++) {
            const pt = state.points[i]
            const isMoving = i === movingIdx && movingPointPosRef.current !== null
            const drawX = isMoving ? movingPointPosRef.current!.x : pt.x
            const drawY = isMoving ? movingPointPosRef.current!.y : pt.y
            const cx = offsetX + drawX * scale
            const cy = offsetY + drawY * scale
            const r = i === hoveredPointIdxRef.current ? 9 : 6
            ctx.save()
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fillStyle = pt.label === 1 ? '#22c55e' : '#ef4444'
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 1.5
            ctx.stroke()
            ctx.restore()
        }
    }, [state.points, state.box, state.exemplarBox, state.exemplarNegBoxes, state.promptMode, liveBox])

    useEffect(() => { redrawCanvasRef.current = redrawCanvas }, [redrawCanvas])

    const transform = transformRef.current
    const activeMask = transform && state.masks.length > 0 ? state.masks[state.selectedMaskIdx] : null

    const getCanvasXY = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect()
        return {
            cx: (e.clientX - rect.left) * (CANVAS_W / rect.width),
            cy: (e.clientY - rect.top) * (CANVAS_H / rect.height),
        }
    }

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const s = stateRef.current
        if (!s.imagePath) return
        const { cx, cy } = getCanvasXY(e)
        const t = transformRef.current
        if (!t) return

        if (s.promptMode === 'box') {
            if (s.box) {
                const hitH = hitTestHandle(cx, cy, s.box, t)
                if (hitH) {
                    dragRef.current = { type: 'resize-box', handle: hitH, startCX: cx, startCY: cy, origBox: s.box }
                    setLiveBox(s.box)
                    return
                }
                if (isInsideBox(cx, cy, s.box, t)) {
                    dragRef.current = { type: 'move-box', startCX: cx, startCY: cy, origBox: s.box }
                    setLiveBox(s.box)
                    return
                }
            }
            dragRef.current = { type: 'draw-box', startCX: cx, startCY: cy }
            didMoveRef.current = false
            return
        }

        if (s.promptMode === 'points') {
            const hitIdx = hitTestPoint(cx, cy, s.points, t)
            if (hitIdx !== null) {
                dragRef.current = { type: 'move-point', index: hitIdx, startCX: cx, startCY: cy, origPt: { ...s.points[hitIdx] } }
                movingPointIdxRef.current = hitIdx
                didMoveRef.current = false
            }
        }

        if (s.promptMode === 'exemplar') {
            dragRef.current = { type: 'draw-box', startCX: cx, startCY: cy }
            didMoveRef.current = false
        }
    }, [])

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { cx, cy } = getCanvasXY(e)
        const t = transformRef.current
        if (!t) return
        const drag = dragRef.current
        const s = stateRef.current

        if (drag.type !== 'none') {
            didMoveRef.current = true
            if (drag.type === 'draw-box') {
                const p1 = toImageCoords(drag.startCX, drag.startCY, t)
                const p2 = toImageCoords(cx, cy, t)
                setLiveBox([Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)])
            } else if (drag.type === 'move-box') {
                const [ox1, oy1, ox2, oy2] = drag.origBox
                const dx = (cx - drag.startCX) / t.scale
                const dy = (cy - drag.startCY) / t.scale
                setLiveBox([Math.round(ox1 + dx), Math.round(oy1 + dy), Math.round(ox2 + dx), Math.round(oy2 + dy)])
            } else if (drag.type === 'resize-box') {
                setLiveBox(applyResizeHandle(drag.handle, drag.origBox, cx - drag.startCX, cy - drag.startCY, t))
            } else if (drag.type === 'move-point') {
                movingPointPosRef.current = toImageCoords(cx, cy, t)
                redrawCanvasRef.current()
            }
            return
        }

        // No active drag — update hover state + cursor
        if (s.promptMode === 'box' && s.imagePath) {
            if (s.box) {
                const hitH = hitTestHandle(cx, cy, s.box, t)
                if (hitH !== hoveredHandleRef.current) { hoveredHandleRef.current = hitH; redrawCanvasRef.current() }
                setCursor(hitH ? getCursorForHandle(hitH) : isInsideBox(cx, cy, s.box, t) ? 'move' : 'crosshair')
            } else {
                setCursor('crosshair')
            }
        } else if (s.promptMode === 'points' && s.imagePath) {
            const hitIdx = hitTestPoint(cx, cy, s.points, t)
            if (hitIdx !== hoveredPointIdxRef.current) { hoveredPointIdxRef.current = hitIdx; redrawCanvasRef.current() }
            setCursor(hitIdx !== null ? 'pointer' : 'cell')
        } else if (s.promptMode === 'exemplar' && s.imagePath) {
            setCursor('crosshair')
        }
    }, [])

    const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current
        if (drag.type === 'none') return
        const { cx, cy } = getCanvasXY(e)
        const t = transformRef.current
        if (!t) return

        if (drag.type === 'draw-box') {
            const p1 = toImageCoords(drag.startCX, drag.startCY, t)
            const p2 = toImageCoords(cx, cy, t)
            const box: [number, number, number, number] = [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)]
            dragRef.current = { type: 'none' }
            setLiveBox(null)
            const s = stateRef.current
            if (s.promptMode === 'exemplar') {
                if (!exemplarDrawIsNeg || !s.exemplarBox) {
                    setExemplarBox(box)
                    predict({ exemplarBox: box, exemplarNegBoxes: s.exemplarNegBoxes })
                } else {
                    addExemplarNegBox(box)
                    predict({ exemplarBox: s.exemplarBox, exemplarNegBoxes: [...s.exemplarNegBoxes, box] })
                }
                return
            }
            setBox(box)
            predict({ box })
        } else if (drag.type === 'move-box') {
            const [ox1, oy1, ox2, oy2] = drag.origBox
            const dx = (cx - drag.startCX) / t.scale
            const dy = (cy - drag.startCY) / t.scale
            const box: [number, number, number, number] = [Math.round(ox1 + dx), Math.round(oy1 + dy), Math.round(ox2 + dx), Math.round(oy2 + dy)]
            dragRef.current = { type: 'none' }
            setLiveBox(null)
            setBox(box)
            predict({ box })
        } else if (drag.type === 'resize-box') {
            const box = applyResizeHandle(drag.handle, drag.origBox, cx - drag.startCX, cy - drag.startCY, t)
            dragRef.current = { type: 'none' }
            setLiveBox(null)
            setBox(box)
            predict({ box })
        } else if (drag.type === 'move-point') {
            movingPointPosRef.current = null
            movingPointIdxRef.current = null
            if (didMoveRef.current) {
                const imgPt = toImageCoords(cx, cy, t)
                const updatedPt: PointPrompt = { x: imgPt.x, y: imgPt.y, label: drag.origPt.label }
                const updatedPoints = stateRef.current.points.map((p, i) => i === drag.index ? updatedPt : p)
                movePoint(drag.index, updatedPt)
                predict({ points: updatedPoints })
            }
            dragRef.current = { type: 'none' }
            redrawCanvasRef.current()
        }
    }, [setBox, predict, movePoint])

    const handleMouseLeave = useCallback(() => {
        if (dragRef.current.type !== 'none') {
            dragRef.current = { type: 'none' }
            movingPointPosRef.current = null
            movingPointIdxRef.current = null
            setLiveBox(null)
        }
        hoveredHandleRef.current = null
        hoveredPointIdxRef.current = null
        const s = stateRef.current
        setCursor(
            (s.promptMode === 'box' || s.promptMode === 'exemplar') && s.imagePath ? 'crosshair' :
            s.promptMode === 'points' && s.imagePath ? 'cell' : 'default'
        )
        redrawCanvasRef.current()
    }, [])

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const s = stateRef.current
        if (s.promptMode !== 'points' || !s.imagePath) return
        if (didMoveRef.current) { didMoveRef.current = false; return }
        const t = transformRef.current
        if (!t) return
        const { cx, cy } = getCanvasXY(e)

        // Click near existing point → delete it and re-predict
        const hitIdx = hitTestPoint(cx, cy, s.points, t)
        if (hitIdx !== null) {
            const updatedPoints = s.points.filter((_, i) => i !== hitIdx)
            removePoint(hitIdx)
            if (updatedPoints.length > 0 || s.box) predict({ points: updatedPoints })
            else clearPrompts()
            return
        }

        if (!isInsideImage(cx, cy, t)) return
        const { x, y } = toImageCoords(cx, cy, t)
        const label = e.shiftKey ? 0 : 1
        const pt: PointPrompt = { x, y, label }
        addPoint(pt)
        predict({ points: [...s.points, pt] })
    }, [addPoint, removePoint, predict, clearPrompts])

    // Reset exemplar draw mode toggle when leaving exemplar mode
    useEffect(() => {
        if (state.promptMode !== 'exemplar') setExemplarDrawIsNeg(false)
    }, [state.promptMode])

    const busy = state.isPredicting || state.isApplying || state.isLoadingImage

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div className="h-full flex flex-col p-4 gap-3 overflow-hidden min-w-[680px]">

            {/* Header */}
            <div>
                <h2 className="text-xl font-semibold text-white">Creative Tools</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                    Segment and edit photos using SAM 3. Load a photo, choose a prompt mode, then apply an operation.
                </p>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 bg-gray-800/60 rounded-lg px-4 py-2.5 border border-gray-700">
                <button
                    onClick={() => setPickerOpen(true)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    From Library
                </button>
                <button
                    onClick={openImageDialog}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    Load File
                </button>

                {/* Mode toggle */}
                <div className="flex rounded-md overflow-hidden border border-gray-600">
                    {MODE_BUTTONS.map(({ mode, label, title }) => {
                        const isTextMode = mode === 'text'
                        const textUnavailable = isTextMode && state.capabilities !== null && !state.capabilities.text_prompts
                        return (
                            <button
                                key={mode}
                                onClick={() => !textUnavailable && setPromptMode(mode)}
                                title={title}
                                disabled={textUnavailable}
                                className={`px-3 py-1.5 text-sm transition-colors ${
                                    textUnavailable
                                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                        : state.promptMode === mode
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>

                {/* Mode hints */}
                {state.promptMode === 'points' && state.imagePath && (
                    <span className="text-xs text-gray-400 italic">
                        Click = include &nbsp;·&nbsp; Shift+click = exclude &nbsp;·&nbsp; Click point = delete &nbsp;·&nbsp; Drag point = move
                        {state.box && <span className="text-indigo-400"> &nbsp;·&nbsp; Box preserved — combined mode active</span>}
                    </span>
                )}
                {state.promptMode === 'box' && state.imagePath && state.box && (
                    <span className="text-xs text-gray-400 italic">
                        Drag handles to resize &nbsp;·&nbsp; Drag inside to move &nbsp;·&nbsp; Delete key clears
                    </span>
                )}
                {state.promptMode === 'exemplar' && state.imagePath && (
                    <span className="text-xs text-gray-400 italic">
                        {!state.exemplarBox
                            ? 'Draw a reference box around one instance'
                            : 'Found instances shown below · draw exclusion boxes to refine · Delete clears all'}
                    </span>
                )}

                {/* Clear / Reset */}
                <button
                    onClick={clearPrompts}
                    disabled={!state.sessionId}
                    className="ml-auto px-3 py-1.5 rounded-md text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Clear
                </button>
                {state.imagePath && (
                    <button
                        onClick={reset}
                        className="px-3 py-1.5 rounded-md text-sm text-gray-400 hover:text-red-400 transition-colors"
                        title="Unload image and reset"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Text mode — input + confidence sliders */}
            {state.promptMode === 'text' && (
                <div className="flex flex-col gap-2 bg-gray-800/60 rounded-lg px-4 py-2.5 border border-gray-700 flex-shrink-0">
                    {/* Text input + Segment button */}
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={state.text}
                            onChange={e => setText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && state.text.trim() && !busy) predict() }}
                            placeholder="person on the left · red umbrella · dog"
                            disabled={!state.sessionId || busy}
                            className="flex-1 bg-gray-900 border border-gray-600 rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                        />
                        <button
                            onClick={() => predict()}
                            disabled={!state.sessionId || !state.text.trim() || busy}
                            className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        >
                            Segment
                        </button>
                    </div>
                    {/* Confidence sliders */}
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-medium w-24 shrink-0">Confidence:</span>
                            <input
                                type="range" min={0.1} max={0.9} step={0.05}
                                value={state.textThreshold}
                                onChange={e => setTextThreshold(Number(e.target.value))}
                                className="w-24 accent-indigo-500"
                                aria-label="Confidence threshold"
                            />
                            <span className="text-xs text-gray-300 w-8 tabular-nums">{state.textThreshold.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-medium w-24 shrink-0">Mask quality:</span>
                            <input
                                type="range" min={0.1} max={0.9} step={0.05}
                                value={state.maskThreshold}
                                onChange={e => setMaskThreshold(Number(e.target.value))}
                                className="w-24 accent-indigo-500"
                                aria-label="Mask quality threshold"
                            />
                            <span className="text-xs text-gray-300 w-8 tabular-nums">{state.maskThreshold.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Exemplar mode — draw-mode toggle (ref vs exclude) */}
            {state.promptMode === 'exemplar' && state.exemplarBox && (
                <div className="flex items-center gap-3 bg-gray-800/60 rounded-lg px-4 py-2 border border-gray-700 flex-shrink-0">
                    <span className="text-xs text-gray-400 font-medium">Draw mode:</span>
                    <div className="flex rounded-md overflow-hidden border border-gray-600">
                        <button
                            onClick={() => setExemplarDrawIsNeg(false)}
                            className={`px-3 py-1 text-xs transition-colors ${!exemplarDrawIsNeg ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                            title="Draw a new reference box (replaces current)"
                        >
                            ⬚ Reference
                        </button>
                        <button
                            onClick={() => setExemplarDrawIsNeg(true)}
                            className={`px-3 py-1 text-xs transition-colors ${exemplarDrawIsNeg ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                            title="Draw exclusion boxes to suppress unwanted instances"
                        >
                            − Exclude
                        </button>
                    </div>
                    {state.exemplarNegBoxes.length > 0 && (
                        <span className="text-xs text-gray-500">
                            {state.exemplarNegBoxes.length} exclusion{state.exemplarNegBoxes.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
            )}

            {/* Error banner */}
            {state.error && (
                <div className="px-4 py-2 rounded-md bg-red-900/50 border border-red-700 text-red-300 text-sm flex-shrink-0">
                    {state.error}
                </div>
            )}

            {state.capabilities && !state.capabilities.model_ready && (
                <div className="px-4 py-2.5 rounded-md bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm flex-shrink-0">
                    {state.capabilities.transformers_compatible === false
                        ? <span>SAM 3 requires transformers 5.0 dev — run: <code className="bg-black/30 px-1 rounded font-mono text-yellow-200 text-xs select-all">{state.capabilities.install_hint ?? 'pip install git+https://github.com/huggingface/transformers.git'}</code></span>
                        : !state.capabilities.model_file_present
                        ? <span>SAM 3 model not downloaded — get it from <strong>Settings → AI Models</strong>.</span>
                        : <span>SAM 3 failed to load: {state.capabilities.error ?? 'check Settings → AI Models'}</span>
                    }
                </div>
            )}

            {/* Canvas + Result — fluid layout, fills available height */}
            <div className="flex-1 flex gap-3 min-h-0">

                {/* Left: canvas — ~65% width. Inner relative div wraps canvas for overlay positioning. */}
                <div className="flex-[3] flex flex-col gap-2 min-h-0 min-w-0">
                    <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-gray-700 bg-gray-900 flex items-center justify-center">
                        <div className="relative" style={{ maxWidth: '100%', maxHeight: '100%' }}>
                            <canvas
                                ref={canvasRef}
                                width={CANVAS_W}
                                height={CANVAS_H}
                                className="block"
                                style={{ maxWidth: '100%', maxHeight: '100%', cursor }}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseLeave}
                                onClick={handleCanvasClick}
                            />

                            {/* Mask overlay — positioned as % of canvas element size */}
                            {activeMask && transform && (
                                <img
                                    src={`data:image/png;base64,${activeMask.mask_b64}`}
                                    alt=""
                                    className="absolute pointer-events-none"
                                    style={{
                                        top: `${(transform.offsetY / CANVAS_H) * 100}%`,
                                        left: `${(transform.offsetX / CANVAS_W) * 100}%`,
                                        width: `${(transform.renderedW / CANVAS_W) * 100}%`,
                                        height: `${(transform.renderedH / CANVAS_H) * 100}%`,
                                        opacity: 0.45,
                                        filter: 'sepia(1) saturate(10) hue-rotate(220deg)',
                                    }}
                                />
                            )}

                            {/* Empty state */}
                            {!state.imagePath && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-2">
                                    <div className="text-4xl">🖼</div>
                                    <div className="text-sm">Load a photo to get started</div>
                                </div>
                            )}

                            {/* Loading overlay */}
                            {busy && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                    <span className="text-white text-sm">
                                        {state.isLoadingImage ? 'Loading image…' :
                                         state.isPredicting ? 'Segmenting…' :
                                         'Applying…'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Mask selector pills */}
                    {state.masks.length > 0 && (
                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                            <span className="text-xs text-gray-400">
                                {(state.promptMode === 'text' || state.promptMode === 'exemplar')
                                    ? `Found ${state.masks.length} instance${state.masks.length !== 1 ? 's' : ''}:`
                                    : 'Mask:'}
                            </span>
                            {state.masks.map((m, i) => (
                                <button
                                    key={i}
                                    onClick={() => setSelectedMaskIdx(i)}
                                    className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                                        state.selectedMaskIdx === i
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                >
                                    {i + 1} ({(m.score * 100).toFixed(0)}%)
                                </button>
                            ))}
                            {(state.promptMode === 'text' || state.promptMode === 'exemplar') && state.masks.length > 1 && (
                                <button
                                    onClick={unionAllMasks}
                                    className="px-2.5 py-1 rounded-md text-xs bg-gray-700 text-indigo-300 hover:bg-gray-600 transition-colors"
                                    title="Merge all instances into a single mask"
                                >
                                    Union All
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Right: result preview — takes ~35% of width */}
                <div
                    className="flex-[2] min-w-[180px] flex flex-col gap-0 rounded-lg border border-gray-700 bg-gray-900 overflow-hidden min-h-0"
                >
                    <div className="px-3 pt-3 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider flex-shrink-0">
                        Result
                    </div>
                    {state.resultB64 ? (
                        <div
                            className="flex-1 flex items-center justify-center p-2 min-h-0"
                            style={{ backgroundImage: 'repeating-conic-gradient(#374151 0% 25%, #1f2937 0% 50%)', backgroundSize: '16px 16px' }}
                        >
                            <img
                                src={`data:image/png;base64,${state.resultB64}`}
                                alt="Result"
                                className="max-w-full max-h-full object-contain"
                            />
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm px-4 text-center">
                            Apply an operation to see the result here
                        </div>
                    )}
                </div>
            </div>

            {/* Operations bar */}
            <CreativeOperationsBar
                hasMasks={state.masks.length > 0}
                busy={busy}
                hasResult={!!state.resultB64}
                resultB64={state.resultB64}
                featherRadius={state.featherRadius}
                invertSelection={state.invertSelection}
                onFeatherChange={setFeatherRadius}
                onInvertChange={setInvertSelection}
                onApply={applyOperation}
            />

            <LibraryPhotoPickerModal
                open={pickerOpen}
                onSelect={loadImage}
                onClose={() => setPickerOpen(false)}
            />
        </div>
    )
}
