import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import type { CanvasTransform } from './canvasHelpers'
import type { BrushMode } from '../hooks/useMaskEditor'

interface Props {
    maskB64: string
    resetNonce: number
    transform: CanvasTransform
    canvasW: number
    canvasH: number
    brushSize: number
    brushMode: BrushMode
    onStrokeEnd: (newMaskB64: string) => void
}

export interface MaskEditorOverlayHandle {
    exportMask: () => string | null
}

const MaskEditorOverlay = forwardRef<MaskEditorOverlayHandle, Props>(function MaskEditorOverlay(
    { maskB64, resetNonce, transform, canvasW, canvasH, brushSize, brushMode, onStrokeEnd },
    ref,
) {
    const canvasRef        = useRef<HTMLCanvasElement>(null)
    const mouseDownRef     = useRef(false)
    const rafRef           = useRef<number | null>(null)
    const pendingRef       = useRef<{ x: number; y: number } | null>(null)
    const naturalDimsRef   = useRef<{ w: number; h: number }>({ w: 1, h: 1 })
    const brushSizeRef     = useRef(brushSize)
    const brushModeRef     = useRef(brushMode)
    // cursor preview div
    const cursorRef        = useRef<HTMLDivElement>(null)

    // Keep brush refs current so the RAF closure always uses the latest values
    useEffect(() => { brushSizeRef.current = brushSize }, [brushSize])
    useEffect(() => { brushModeRef.current = brushMode }, [brushMode])

    // -----------------------------------------------------------------------
    // Initialise / reinitialise canvas from maskB64
    // resetNonce bumped by parent on undo/redo so we reload from the updated maskB64
    // -----------------------------------------------------------------------

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const img = new Image()
        img.onload = () => {
            canvas.width  = img.naturalWidth
            canvas.height = img.naturalHeight
            naturalDimsRef.current = { w: img.naturalWidth, h: img.naturalHeight }
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(img, 0, 0)
        }
        img.src = `data:image/png;base64,${maskB64}`
    }, [maskB64, resetNonce])  // resetNonce forces reinit on undo/redo

    // -----------------------------------------------------------------------
    // Brush size via scroll wheel
    // -----------------------------------------------------------------------

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const handler = (e: WheelEvent) => {
            e.preventDefault()
            // Trigger setBrushSize via a CustomEvent that the parent toolbar can listen to,
            // OR we expose a callback. For simplicity the wheel on overlay just dispatches
            // a custom event the parent hooks into. Actually simpler: expose via prop change.
            // We use a workaround: store tentative size in ref and expose it.
            const delta = e.deltaY < 0 ? 2 : -2
            const next  = Math.max(2, Math.min(80, brushSizeRef.current + delta))
            brushSizeRef.current = next
            // Update cursor preview size
            if (cursorRef.current) {
                cursorRef.current.style.width  = `${next}px`
                cursorRef.current.style.height = `${next}px`
            }
        }
        canvas.addEventListener('wheel', handler, { passive: false })
        return () => canvas.removeEventListener('wheel', handler)
    }, [])

    // -----------------------------------------------------------------------
    // Imperative handle: export current canvas to base64
    // -----------------------------------------------------------------------

    useImperativeHandle(ref, () => ({
        exportMask: () => {
            const canvas = canvasRef.current
            if (!canvas) return null
            return canvas.toDataURL('image/png').split(',')[1]
        },
    }))

    // -----------------------------------------------------------------------
    // Drawing
    // -----------------------------------------------------------------------

    const drawAt = useCallback((imageX: number, imageY: number) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const r = brushSizeRef.current / 2
        ctx.fillStyle = brushModeRef.current === 'erase' ? 'black' : 'white'
        ctx.beginPath()
        ctx.arc(imageX, imageY, r, 0, Math.PI * 2)
        ctx.fill()
    }, [])

    const toImageCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const { w, h } = naturalDimsRef.current
        return {
            x: (clientX - rect.left) * (w / rect.width),
            y: (clientY - rect.top)  * (h / rect.height),
        }
    }, [])

    const flushPending = useCallback(() => {
        rafRef.current = null
        const pt = pendingRef.current
        pendingRef.current = null
        if (pt) drawAt(pt.x, pt.y)
    }, [drawAt])

    const scheduleDraw = useCallback((clientX: number, clientY: number) => {
        const pt = toImageCoords(clientX, clientY)
        if (!pt) return
        pendingRef.current = pt
        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(flushPending)
        }
    }, [toImageCoords, flushPending])

    // -----------------------------------------------------------------------
    // Mouse handlers
    // -----------------------------------------------------------------------

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return
        mouseDownRef.current = true
        scheduleDraw(e.clientX, e.clientY)
    }, [scheduleDraw])

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        // Update cursor preview position
        if (cursorRef.current) {
            const rect = canvasRef.current?.getBoundingClientRect()
            if (rect) {
                const relX = e.clientX - rect.left
                const relY = e.clientY - rect.top
                cursorRef.current.style.left = `${relX}px`
                cursorRef.current.style.top  = `${relY}px`
            }
        }
        if (!mouseDownRef.current) return
        scheduleDraw(e.clientX, e.clientY)
    }, [scheduleDraw])

    const handleMouseUp = useCallback(() => {
        if (!mouseDownRef.current) return
        mouseDownRef.current = false
        // Flush any pending RAF draw immediately
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            const pt = pendingRef.current
            pendingRef.current = null
            if (pt) drawAt(pt.x, pt.y)
        }
        // Export canvas and push to history via parent
        const canvas = canvasRef.current
        if (!canvas) return
        const b64 = canvas.toDataURL('image/png').split(',')[1]
        onStrokeEnd(b64)
    }, [drawAt, onStrokeEnd])

    const handleMouseLeave = useCallback(() => {
        if (cursorRef.current) cursorRef.current.style.display = 'none'
        if (mouseDownRef.current) handleMouseUp()
    }, [handleMouseUp])

    const handleMouseEnter = useCallback(() => {
        if (cursorRef.current) cursorRef.current.style.display = 'block'
    }, [])

    // -----------------------------------------------------------------------
    // CSS positioning — covers the exact image area within the main canvas
    // -----------------------------------------------------------------------

    const style: React.CSSProperties = {
        position:  'absolute',
        top:    `${(transform.offsetY / canvasH) * 100}%`,
        left:   `${(transform.offsetX / canvasW) * 100}%`,
        width:  `${(transform.renderedW / canvasW) * 100}%`,
        height: `${(transform.renderedH / canvasH) * 100}%`,
        overflow: 'hidden',
    }

    const cursorSize = brushSize
    const isErase    = brushMode === 'erase'

    return (
        <div style={style}>
            <canvas
                ref={canvasRef}
                className="block w-full h-full"
                style={{ opacity: 0.55, filter: 'sepia(1) saturate(10) hue-rotate(220deg)', cursor: 'none' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onMouseEnter={handleMouseEnter}
            />
            {/* Cursor preview circle */}
            <div
                ref={cursorRef}
                className="absolute pointer-events-none rounded-full border-2"
                style={{
                    width:  cursorSize,
                    height: cursorSize,
                    borderColor: isErase ? '#ef4444' : '#22c55e',
                    backgroundColor: isErase ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                    transform: 'translate(-50%, -50%)',
                    display: 'none',
                }}
            />
        </div>
    )
})

export default MaskEditorOverlay
