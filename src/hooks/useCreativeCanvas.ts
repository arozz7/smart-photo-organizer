import { useRef, useState, useCallback, useEffect } from 'react'
import type { SegmentState, PointPrompt, PredictOverride } from '../types/segmentation'
import {
    CanvasTransform, BoxHandle, DragAction,
    toImageCoords, isInsideImage,
    getBoxHandlePositions, hitTestHandle, hitTestPoint,
    isInsideBox, applyResizeHandle, getCursorForHandle,
    computeCanvasTransform,
} from '../components/canvasHelpers'

export const CANVAS_W = 680
export const CANVAS_H = 480

// ---------------------------------------------------------------------------
// View state (zoom + pan) — updated atomically to avoid tearing
// ---------------------------------------------------------------------------

interface ViewState { zoom: number; panX: number; panY: number }
const DEFAULT_VIEW: ViewState = { zoom: 1.0, panX: 0, panY: 0 }

// ---------------------------------------------------------------------------
// Options passed in from the parent component
// ---------------------------------------------------------------------------

export interface UseCreativeCanvasOptions {
    state: SegmentState
    exemplarDrawIsNeg: boolean
    setBox: (box: [number, number, number, number] | null) => void
    setExemplarBox: (box: [number, number, number, number] | null) => void
    addExemplarNegBox: (box: [number, number, number, number]) => void
    predict: (override?: PredictOverride) => Promise<void>
    addPoint: (pt: PointPrompt) => void
    removePoint: (idx: number) => void
    movePoint: (idx: number, pt: PointPrompt) => void
    clearPrompts: () => void
    clearExemplarBoxes: () => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCreativeCanvas(opts: UseCreativeCanvasOptions) {
    const {
        state, exemplarDrawIsNeg,
        setBox, setExemplarBox, addExemplarNegBox,
        predict, addPoint, removePoint, movePoint,
        clearPrompts, clearExemplarBoxes,
    } = opts

    // DOM / mutable refs
    const canvasRef       = useRef<HTMLCanvasElement>(null)
    const imageRef        = useRef<HTMLImageElement | null>(null)
    const transformRef    = useRef<CanvasTransform | null>(null)
    const dragRef         = useRef<DragAction>({ type: 'none' })
    const didMoveRef      = useRef(false)
    const hoveredHandleRef    = useRef<BoxHandle | null>(null)
    const hoveredPointIdxRef  = useRef<number | null>(null)
    const movingPointPosRef   = useRef<{ x: number; y: number } | null>(null)
    const movingPointIdxRef   = useRef<number | null>(null)
    const redrawCanvasRef     = useRef<() => void>(() => {})

    // Stable refs for values read inside callbacks (avoids stale closure)
    const stateRef         = useRef(state)
    const liveBoxRef       = useRef<[number, number, number, number] | null>(null)
    const viewStateRef     = useRef<ViewState>(DEFAULT_VIEW)
    const spaceDownRef     = useRef(false)

    // React state — drives JSX re-renders
    const [cursor,   setCursor]   = useState('default')
    const [liveBox,  setLiveBox]  = useState<[number, number, number, number] | null>(null)
    const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW)

    // Keep refs in sync after every render
    useEffect(() => { stateRef.current = state })
    useEffect(() => { liveBoxRef.current = liveBox })
    useEffect(() => { viewStateRef.current = viewState })

    // -----------------------------------------------------------------------
    // Reset view when image changes
    // -----------------------------------------------------------------------

    useEffect(() => {
        if (!state.imagePath) return
        const img = new Image()
        img.onload = () => {
            imageRef.current = img
            setViewState(DEFAULT_VIEW)
            viewStateRef.current = DEFAULT_VIEW
            redrawCanvasRef.current()
        }
        // @ts-ignore
        img.src = `file://${state.imagePath}`
    }, [state.imagePath])

    // Redraw when prompt state or liveBox or viewState changes
    useEffect(() => {
        redrawCanvasRef.current()
    }, [state.points, state.box, state.exemplarBox, state.exemplarNegBoxes, liveBox, viewState])

    // -----------------------------------------------------------------------
    // Delete key — clears box / exemplar prompts
    // -----------------------------------------------------------------------

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const s = stateRef.current
            if (s.editingMask) return
            if (e.key === 'Delete') {
                if (s.promptMode === 'box' && s.box) clearPrompts()
                else if (s.promptMode === 'exemplar' && (s.exemplarBox || s.exemplarNegBoxes.length)) clearExemplarBoxes()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [clearPrompts, clearExemplarBoxes])

    // -----------------------------------------------------------------------
    // Space key tracking (for pan gesture)
    // -----------------------------------------------------------------------

    useEffect(() => {
        const onDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName
            const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
            if (e.code === 'Space' && !e.repeat && !isEditable) { e.preventDefault(); spaceDownRef.current = true }
        }
        const onUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') spaceDownRef.current = false
        }
        window.addEventListener('keydown', onDown)
        window.addEventListener('keyup',   onUp)
        return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
    }, [])

    // -----------------------------------------------------------------------
    // Wheel event — zoom to cursor (non-passive to allow preventDefault)
    // -----------------------------------------------------------------------

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const handler = (e: WheelEvent) => {
            if (stateRef.current.editingMask) return
            e.preventDefault()
            const img = imageRef.current
            if (!img) return
            const rect = canvas.getBoundingClientRect()
            const cx = (e.clientX - rect.left) * (CANVAS_W / rect.width)
            const cy = (e.clientY - rect.top)  * (CANVAS_H / rect.height)
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15

            setViewState(prev => {
                const newZoom = Math.max(0.5, Math.min(8, prev.zoom * factor))
                const baseScale = Math.min(CANVAS_W / img.naturalWidth, CANVAS_H / img.naturalHeight)
                const fitW = img.naturalWidth  * baseScale
                const fitH = img.naturalHeight * baseScale
                // Image-space coords under cursor in old transform
                const oldOffsetX = (CANVAS_W - fitW * prev.zoom) / 2 + prev.panX
                const oldOffsetY = (CANVAS_H - fitH * prev.zoom) / 2 + prev.panY
                const imgX = (cx - oldOffsetX) / (baseScale * prev.zoom)
                const imgY = (cy - oldOffsetY) / (baseScale * prev.zoom)
                // New offsets keep that image point under the cursor
                const newRenderedW = fitW * newZoom
                const newRenderedH = fitH * newZoom
                const newOffsetX = cx - imgX * baseScale * newZoom
                const newOffsetY = cy - imgY * baseScale * newZoom
                return {
                    zoom: newZoom,
                    panX: newOffsetX - (CANVAS_W - newRenderedW) / 2,
                    panY: newOffsetY - (CANVAS_H - newRenderedH) / 2,
                }
            })
        }
        canvas.addEventListener('wheel', handler, { passive: false })
        return () => canvas.removeEventListener('wheel', handler)
    }, [])

    // -----------------------------------------------------------------------
    // Zoom controls
    // -----------------------------------------------------------------------

    const fitToView = useCallback(() => setViewState(DEFAULT_VIEW), [])
    const zoomIn    = useCallback(() => setViewState(p => ({ ...p, zoom: Math.min(8,   p.zoom * 1.25) })), [])
    const zoomOut   = useCallback(() => setViewState(p => ({ ...p, zoom: Math.max(0.5, p.zoom / 1.25) })), [])

    // -----------------------------------------------------------------------
    // Canvas drawing
    // -----------------------------------------------------------------------

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

        const vs = viewStateRef.current
        const t  = computeCanvasTransform(img.naturalWidth, img.naturalHeight, CANVAS_W, CANVAS_H, vs.zoom, vs.panX, vs.panY)
        transformRef.current = t

        ctx.drawImage(img, t.offsetX, t.offsetY, t.renderedW, t.renderedH)

        const s         = stateRef.current
        const activeBox = liveBoxRef.current ?? s.box

        // Skip prompt overlays while mask is being edited
        if (s.editingMask) return

        // Box
        if (activeBox) {
            const [x1, y1, x2, y2] = activeBox
            ctx.save()
            ctx.strokeStyle = '#6366f1'
            ctx.lineWidth = 2
            ctx.setLineDash([5, 3])
            ctx.strokeRect(t.offsetX + x1 * t.scale, t.offsetY + y1 * t.scale, (x2 - x1) * t.scale, (y2 - y1) * t.scale)
            ctx.restore()

            if (!liveBoxRef.current && dragRef.current.type === 'none') {
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

        // Exemplar boxes
        if (s.promptMode === 'exemplar') {
            const drawExemplarBox = (box: [number, number, number, number], color: string, dash: number[] = []) => {
                const [x1, y1, x2, y2] = box
                ctx.save()
                ctx.strokeStyle = color
                ctx.lineWidth = 2
                ctx.setLineDash(dash)
                ctx.strokeRect(t.offsetX + x1 * t.scale, t.offsetY + y1 * t.scale, (x2 - x1) * t.scale, (y2 - y1) * t.scale)
                ctx.restore()
            }
            if (liveBoxRef.current) drawExemplarBox(liveBoxRef.current, '#6366f1', [5, 3])
            if (s.exemplarBox)      drawExemplarBox(s.exemplarBox, '#22c55e')
            for (const neg of s.exemplarNegBoxes) drawExemplarBox(neg, '#ef4444')
        }

        // Points
        const movingIdx = movingPointIdxRef.current
        for (let i = 0; i < s.points.length; i++) {
            const pt = s.points[i]
            const isMoving = i === movingIdx && movingPointPosRef.current !== null
            const drawX = isMoving ? movingPointPosRef.current!.x : pt.x
            const drawY = isMoving ? movingPointPosRef.current!.y : pt.y
            const cx = t.offsetX + drawX * t.scale
            const cy = t.offsetY + drawY * t.scale
            const r  = i === hoveredPointIdxRef.current ? 9 : 6
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
    }, [])  // stable — reads all values via refs

    useEffect(() => { redrawCanvasRef.current = redrawCanvas }, [redrawCanvas])

    // -----------------------------------------------------------------------
    // Coordinate helper
    // -----------------------------------------------------------------------

    const getCanvasXY = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect()
        return {
            cx: (e.clientX - rect.left) * (CANVAS_W / rect.width),
            cy: (e.clientY - rect.top)  * (CANVAS_H / rect.height),
        }
    }

    // -----------------------------------------------------------------------
    // Mouse handlers
    // -----------------------------------------------------------------------

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const s = stateRef.current
        if (s.editingMask) return

        const { cx, cy } = getCanvasXY(e)

        // Middle-button or Space+drag → pan
        if (e.button === 1 || spaceDownRef.current) {
            e.preventDefault()
            dragRef.current = { type: 'pan', startCX: cx, startCY: cy, startPanX: viewStateRef.current.panX, startPanY: viewStateRef.current.panY }
            return
        }

        if (!s.imagePath) return
        const t = transformRef.current
        if (!t) return

        if (s.promptMode === 'box') {
            if (s.box) {
                const hitH = hitTestHandle(cx, cy, s.box, t)
                if (hitH) {
                    dragRef.current = { type: 'resize-box', handle: hitH, startCX: cx, startCY: cy, origBox: s.box }
                    liveBoxRef.current = s.box
                    setLiveBox(s.box)
                    return
                }
                if (isInsideBox(cx, cy, s.box, t)) {
                    dragRef.current = { type: 'move-box', startCX: cx, startCY: cy, origBox: s.box }
                    liveBoxRef.current = s.box
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
        const t    = transformRef.current
        const drag = dragRef.current
        const s    = stateRef.current

        if (drag.type !== 'none') {
            didMoveRef.current = true

            if (drag.type === 'pan') {
                const newPanX = drag.startPanX + (cx - drag.startCX)
                const newPanY = drag.startPanY + (cy - drag.startCY)
                setViewState(prev => ({ ...prev, panX: newPanX, panY: newPanY }))
                return
            }

            if (!t) return

            if (drag.type === 'draw-box') {
                const p1 = toImageCoords(drag.startCX, drag.startCY, t)
                const p2 = toImageCoords(cx, cy, t)
                const box: [number, number, number, number] = [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)]
                liveBoxRef.current = box
                setLiveBox(box)
            } else if (drag.type === 'move-box') {
                const [ox1, oy1, ox2, oy2] = drag.origBox
                const dx = (cx - drag.startCX) / t.scale
                const dy = (cy - drag.startCY) / t.scale
                const box: [number, number, number, number] = [Math.round(ox1 + dx), Math.round(oy1 + dy), Math.round(ox2 + dx), Math.round(oy2 + dy)]
                liveBoxRef.current = box
                setLiveBox(box)
            } else if (drag.type === 'resize-box') {
                const box = applyResizeHandle(drag.handle, drag.origBox, cx - drag.startCX, cy - drag.startCY, t)
                liveBoxRef.current = box
                setLiveBox(box)
            } else if (drag.type === 'move-point') {
                movingPointPosRef.current = toImageCoords(cx, cy, t)
                redrawCanvasRef.current()
            }
            return
        }

        if (!t) return

        // No active drag — update hover state + cursor
        if (s.promptMode === 'box' && s.imagePath) {
            if (s.box) {
                const hitH = hitTestHandle(cx, cy, s.box, t)
                if (hitH !== hoveredHandleRef.current) { hoveredHandleRef.current = hitH; redrawCanvasRef.current() }
                setCursor(hitH ? getCursorForHandle(hitH) : isInsideBox(cx, cy, s.box, t) ? 'move' : 'crosshair')
            } else {
                setCursor(spaceDownRef.current ? 'grab' : 'crosshair')
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

        if (drag.type === 'pan') {
            dragRef.current = { type: 'none' }
            return
        }

        const { cx, cy } = getCanvasXY(e)
        const t = transformRef.current
        if (!t) return

        if (drag.type === 'draw-box') {
            const p1 = toImageCoords(drag.startCX, drag.startCY, t)
            const p2 = toImageCoords(cx, cy, t)
            const box: [number, number, number, number] = [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)]
            dragRef.current = { type: 'none' }
            liveBoxRef.current = null
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
            liveBoxRef.current = null
            setLiveBox(null)
            setBox(box)
            predict({ box })
        } else if (drag.type === 'resize-box') {
            const box = applyResizeHandle(drag.handle, drag.origBox, cx - drag.startCX, cy - drag.startCY, t)
            dragRef.current = { type: 'none' }
            liveBoxRef.current = null
            setLiveBox(null)
            setBox(box)
            predict({ box })
        } else if (drag.type === 'move-point') {
            movingPointPosRef.current = null
            movingPointIdxRef.current = null
            if (didMoveRef.current) {
                const imgPt     = toImageCoords(cx, cy, t)
                const updatedPt: PointPrompt = { x: imgPt.x, y: imgPt.y, label: drag.origPt.label }
                const updatedPoints = stateRef.current.points.map((p, i) => i === drag.index ? updatedPt : p)
                movePoint(drag.index, updatedPt)
                predict({ points: updatedPoints })
            }
            dragRef.current = { type: 'none' }
            redrawCanvasRef.current()
        }
    }, [setBox, predict, movePoint, exemplarDrawIsNeg, setExemplarBox, addExemplarNegBox])

    const handleMouseLeave = useCallback(() => {
        const drag = dragRef.current
        if (drag.type !== 'none' && drag.type !== 'pan') {
            dragRef.current = { type: 'none' }
            movingPointPosRef.current = null
            movingPointIdxRef.current = null
            liveBoxRef.current = null
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
        if (s.editingMask) return
        if (s.promptMode !== 'points' || !s.imagePath) return
        if (didMoveRef.current) { didMoveRef.current = false; return }
        const t = transformRef.current
        if (!t) return
        const { cx, cy } = getCanvasXY(e)

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

    // -----------------------------------------------------------------------
    // Derived values for the component to use in JSX
    // -----------------------------------------------------------------------

    // Compute transform from React state so the mask overlay is always in sync
    // with the current zoom/pan — transformRef.current lags by one render cycle.
    const transform = imageRef.current
        ? computeCanvasTransform(
              imageRef.current.naturalWidth,
              imageRef.current.naturalHeight,
              CANVAS_W, CANVAS_H,
              viewState.zoom, viewState.panX, viewState.panY,
          )
        : null
    transformRef.current = transform

    const activeMask = transform && state.masks.length > 0 ? state.masks[state.selectedMaskIdx] : null

    return {
        canvasRef,
        cursor,
        liveBox,
        transform,
        activeMask,
        userZoom: viewState.zoom,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleMouseLeave,
        handleCanvasClick,
        zoomIn,
        zoomOut,
        fitToView,
    }
}
