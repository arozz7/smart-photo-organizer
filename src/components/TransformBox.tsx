/**
 * TransformBox — Phase 118
 *
 * An SVG overlay rendered on top of the composition preview `<img>`.
 * It covers the same rendered area as the image and uses `viewBox` equal
 * to the canvas logical dimensions so all coordinates are in canvas-space.
 *
 * Features:
 *  - 8-handle bounding box (4 corners + 4 edge midpoints)
 *  - Rotation grip above top-center
 *  - Move by dragging inside the box
 *  - Flip H / Flip V mini-toolbar
 *  - Numeric HUD (W × H, rotation angle — editable)
 *  - Shift-snap: rotation snaps to 15° increments when Shift held
 */

import { useCallback, useEffect, useRef, useState, PointerEvent as ReactPointerEvent } from 'react'
import { LayerSpec, LayerTransform } from '../types/compositor'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HANDLE_R = 6          // handle circle radius in canvas-space units
const ROTATION_GRIP_OFFSET = 24  // px above the top-center edge handle
const SNAP_DEGREES = 15

// ---------------------------------------------------------------------------
// Geometry helpers (all in canvas-space coordinates)
// ---------------------------------------------------------------------------

/** Rotate point (px, py) around (cx, cy) by angleDeg degrees. */
export function rotatePoint(
    px: number, py: number,
    cx: number, cy: number,
    angleDeg: number,
): [number, number] {
    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const dx = px - cx
    const dy = py - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

/** Compute the 8 handle positions for a layer's bounding box in canvas-space. */
export function computeHandles(layer: LayerSpec): {
    tl: [number, number]; tm: [number, number]; tr: [number, number]
    ml: [number, number];                        mr: [number, number]
    bl: [number, number]; bm: [number, number]; br: [number, number]
    cx: number; cy: number
    w: number; h: number
} {
    const w = layer.sourceWidth * Math.abs(layer.scaleX)
    const h = layer.sourceHeight * Math.abs(layer.scaleY)
    const cx = layer.x + w / 2
    const cy = layer.y + h / 2
    const rot = layer.rotation

    const rp = (px: number, py: number): [number, number] =>
        rotatePoint(px, py, cx, cy, rot)

    return {
        tl: rp(layer.x,         layer.y),
        tm: rp(layer.x + w / 2, layer.y),
        tr: rp(layer.x + w,     layer.y),
        ml: rp(layer.x,         layer.y + h / 2),
        mr: rp(layer.x + w,     layer.y + h / 2),
        bl: rp(layer.x,         layer.y + h),
        bm: rp(layer.x + w / 2, layer.y + h),
        br: rp(layer.x + w,     layer.y + h),
        cx, cy, w, h,
    }
}

/** Rotation grip position — above tm, offset along the layer's local Y-up axis. */
export function computeRotationGrip(
    tm: [number, number],
    cx: number, cy: number,
    rotation: number,
): [number, number] {
    // Direction from centroid toward tm (then continue outward)
    const dx = tm[0] - cx
    const dy = tm[1] - cy
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    return [
        tm[0] + (dx / len) * ROTATION_GRIP_OFFSET,
        tm[1] + (dy / len) * ROTATION_GRIP_OFFSET,
    ]
}

/** Snap angle to SNAP_DEGREES increments. */
export function snapAngle(deg: number): number {
    return Math.round(deg / SNAP_DEGREES) * SNAP_DEGREES
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TransformBoxProps {
    layer: LayerSpec
    canvasW: number
    canvasH: number
    onTransformChange: (t: LayerTransform) => void
}

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

type DragKind =
    | 'move'
    | 'tl' | 'tm' | 'tr' | 'ml' | 'mr' | 'bl' | 'bm' | 'br'
    | 'rotate'

interface DragState {
    kind: DragKind
    startPointerX: number
    startPointerY: number
    startTransform: LayerTransform
    startCx: number
    startCy: number
    shiftHeld: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TransformBox({ layer, canvasW, canvasH, onTransformChange }: TransformBoxProps) {
    const svgRef = useRef<SVGSVGElement>(null)
    const dragRef = useRef<DragState | null>(null)

    // Local transform state so the box feels responsive before the debounced
    // re-composite fires
    const [local, setLocal] = useState<LayerTransform>({
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        rotation: layer.rotation,
    })

    // Sync when the upstream layer prop changes (after re-composite)
    useEffect(() => {
        setLocal({
            x: layer.x,
            y: layer.y,
            scaleX: layer.scaleX,
            scaleY: layer.scaleY,
            rotation: layer.rotation,
        })
    }, [layer.x, layer.y, layer.scaleX, layer.scaleY, layer.rotation])

    // Build a display layer by merging local transform onto the prop
    const displayLayer: LayerSpec = { ...layer, ...local }
    const handles = computeHandles(displayLayer)
    const { tl, tm, tr, ml, mr, bl, bm, br, cx, cy } = handles
    const rotGrip = computeRotationGrip(tm, cx, cy, local.rotation)

    // ------------------------------------------------------------------
    // SVG coordinate helper — convert a browser PointerEvent to SVG coords
    // ------------------------------------------------------------------

    const svgCoords = useCallback((e: { clientX: number; clientY: number }): [number, number] => {
        const svg = svgRef.current
        if (!svg) return [0, 0]
        const pt = svg.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse())
        return [svgP.x, svgP.y]
    }, [])

    // ------------------------------------------------------------------
    // Pointer down — start drag
    // ------------------------------------------------------------------

    const onPointerDown = useCallback((kind: DragKind) => (e: ReactPointerEvent<SVGElement>) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const [sx, sy] = svgCoords(e)
        dragRef.current = {
            kind,
            startPointerX: sx,
            startPointerY: sy,
            startTransform: { ...local },
            startCx: cx,
            startCy: cy,
            shiftHeld: e.shiftKey,
        }
    }, [local, cx, cy, svgCoords])

    // ------------------------------------------------------------------
    // Pointer move — apply drag
    // ------------------------------------------------------------------

    const onPointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
        const drag = dragRef.current
        if (!drag) return

        const [px, py] = svgCoords(e)
        const dx = px - drag.startPointerX
        const dy = py - drag.startPointerY
        const st = drag.startTransform
        const w = layer.sourceWidth * Math.abs(st.scaleX)
        const h = layer.sourceHeight * Math.abs(st.scaleY)

        let next: LayerTransform = { ...st }

        if (drag.kind === 'move') {
            next = { ...st, x: st.x + dx, y: st.y + dy }

        } else if (drag.kind === 'rotate') {
            // Angle from centroid to current pointer vs start pointer
            const startAngle = Math.atan2(
                drag.startPointerY - drag.startCy,
                drag.startPointerX - drag.startCx,
            ) * (180 / Math.PI)
            const currAngle = Math.atan2(
                py - drag.startCy,
                px - drag.startCx,
            ) * (180 / Math.PI)
            let newRotation = st.rotation + (currAngle - startAngle)
            if (e.shiftKey) newRotation = snapAngle(newRotation)
            next = { ...st, rotation: newRotation }

        } else {
            // Scale handles
            // We work in an unrotated space: unrotate the delta
            const rad = -(st.rotation * Math.PI) / 180
            const cos = Math.cos(rad)
            const sin = Math.sin(rad)
            const ldx = dx * cos - dy * sin
            const ldy = dx * sin + dy * cos

            let newW = w
            let newH = h
            let newX = st.x
            let newY = st.y

            const scaleSignX = st.scaleX < 0 ? -1 : 1
            const scaleSignY = st.scaleY < 0 ? -1 : 1

            switch (drag.kind) {
                case 'br': newW = Math.max(4, w + ldx); newH = Math.max(4, h + ldy); break
                case 'bl': newW = Math.max(4, w - ldx); newH = Math.max(4, h + ldy);
                    newX = st.x + (w - newW); break
                case 'tr': newW = Math.max(4, w + ldx); newH = Math.max(4, h - ldy);
                    newY = st.y + (h - newH); break
                case 'tl': newW = Math.max(4, w - ldx); newH = Math.max(4, h - ldy);
                    newX = st.x + (w - newW); newY = st.y + (h - newH); break
                case 'mr': newW = Math.max(4, w + ldx); break
                case 'ml': newW = Math.max(4, w - ldx); newX = st.x + (w - newW); break
                case 'bm': newH = Math.max(4, h + ldy); break
                case 'tm': newH = Math.max(4, h - ldy); newY = st.y + (h - newH); break
            }

            next = {
                ...st,
                x: newX,
                y: newY,
                scaleX: scaleSignX * (newW / layer.sourceWidth),
                scaleY: scaleSignY * (newH / layer.sourceHeight),
            }
        }

        setLocal(next)
        onTransformChange(next)
    }, [layer.sourceWidth, layer.sourceHeight, svgCoords, onTransformChange])

    const onPointerUp = useCallback(() => {
        dragRef.current = null
    }, [])

    // ------------------------------------------------------------------
    // Flip buttons
    // ------------------------------------------------------------------

    const flipH = useCallback(() => {
        const next = { ...local, scaleX: -local.scaleX }
        setLocal(next)
        onTransformChange(next)
    }, [local, onTransformChange])

    const flipV = useCallback(() => {
        const next = { ...local, scaleY: -local.scaleY }
        setLocal(next)
        onTransformChange(next)
    }, [local, onTransformChange])

    // ------------------------------------------------------------------
    // Numeric HUD handlers
    // ------------------------------------------------------------------

    const handleWChange = useCallback((raw: string) => {
        const v = parseFloat(raw)
        if (!isFinite(v) || v <= 0) return
        const next = { ...local, scaleX: (local.scaleX < 0 ? -1 : 1) * (v / layer.sourceWidth) }
        setLocal(next)
        onTransformChange(next)
    }, [local, layer.sourceWidth, onTransformChange])

    const handleHChange = useCallback((raw: string) => {
        const v = parseFloat(raw)
        if (!isFinite(v) || v <= 0) return
        const next = { ...local, scaleY: (local.scaleY < 0 ? -1 : 1) * (v / layer.sourceHeight) }
        setLocal(next)
        onTransformChange(next)
    }, [local, layer.sourceHeight, onTransformChange])

    const handleRotChange = useCallback((raw: string) => {
        const v = parseFloat(raw)
        if (!isFinite(v)) return
        const next = { ...local, rotation: v }
        setLocal(next)
        onTransformChange(next)
    }, [local, onTransformChange])

    // ------------------------------------------------------------------
    // Derived display values
    // ------------------------------------------------------------------

    const dispW = Math.round(Math.abs(local.scaleX) * layer.sourceWidth)
    const dispH = Math.round(Math.abs(local.scaleY) * layer.sourceHeight)
    const dispRot = Math.round(local.rotation * 10) / 10

    // Polygon points string for the bounding box
    const polyPoints = [tl, tr, br, bl].map(([x, y]) => `${x},${y}`).join(' ')

    // HUD position — below the bounding box's bottom-center in canvas space
    const hudX = (bl[0] + br[0]) / 2
    const hudY = (bl[1] + br[1]) / 2

    // Toolbar position — above the top-center
    const toolbarX = (tl[0] + tr[0]) / 2
    const toolbarY = (tl[1] + tr[1]) / 2

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    const HANDLE_STYLE = {
        fill: '#6366f1',
        stroke: '#fff',
        strokeWidth: 1.5,
        cursor: 'pointer',
    }

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${canvasW} ${canvasH}`}
            className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
            style={{ top: 0, left: 0 }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            {/* Bounding box outline */}
            <polygon
                points={polyPoints}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                className="pointer-events-auto cursor-move"
                onPointerDown={onPointerDown('move')}
            />

            {/* Edge + corner handles */}
            {([
                ['tl', tl, 'nwse-resize'],
                ['tm', tm, 'ns-resize'],
                ['tr', tr, 'nesw-resize'],
                ['ml', ml, 'ew-resize'],
                ['mr', mr, 'ew-resize'],
                ['bl', bl, 'nesw-resize'],
                ['bm', bm, 'ns-resize'],
                ['br', br, 'nwse-resize'],
            ] as const).map(([kind, [hx, hy], cursor]) => (
                <circle
                    key={kind}
                    cx={hx} cy={hy} r={HANDLE_R}
                    {...HANDLE_STYLE}
                    style={{ ...HANDLE_STYLE, cursor }}
                    className="pointer-events-auto"
                    onPointerDown={onPointerDown(kind)}
                />
            ))}

            {/* Rotation grip stem line */}
            <line
                x1={tm[0]} y1={tm[1]}
                x2={rotGrip[0]} y2={rotGrip[1]}
                stroke="#6366f1" strokeWidth={1.5}
            />

            {/* Rotation grip circle */}
            <circle
                cx={rotGrip[0]} cy={rotGrip[1]} r={HANDLE_R}
                fill="#818cf8"
                stroke="#fff"
                strokeWidth={1.5}
                style={{ cursor: 'crosshair' }}
                className="pointer-events-auto"
                onPointerDown={onPointerDown('rotate')}
            />

            {/* Flip mini-toolbar */}
            <foreignObject
                x={toolbarX - 44}
                y={toolbarY - ROTATION_GRIP_OFFSET - 28}
                width={88}
                height={22}
                className="pointer-events-auto overflow-visible"
            >
                <div
                    style={{ display: 'flex', gap: 4, background: 'rgba(30,27,75,0.85)',
                        borderRadius: 4, padding: '2px 4px' }}
                >
                    <button
                        onClick={flipH}
                        style={{ fontSize: 10, color: '#c7d2fe', background: 'none',
                            border: 'none', cursor: 'pointer', padding: '0 4px' }}
                        title="Flip horizontal"
                    >⇔ H</button>
                    <button
                        onClick={flipV}
                        style={{ fontSize: 10, color: '#c7d2fe', background: 'none',
                            border: 'none', cursor: 'pointer', padding: '0 4px' }}
                        title="Flip vertical"
                    >⇕ V</button>
                </div>
            </foreignObject>

            {/* Numeric HUD */}
            <foreignObject
                x={hudX - 110}
                y={hudY + 8}
                width={220}
                height={28}
                className="pointer-events-auto overflow-visible"
            >
                <div
                    style={{ display: 'flex', gap: 4, alignItems: 'center',
                        background: 'rgba(30,27,75,0.85)', borderRadius: 4,
                        padding: '2px 6px', fontSize: 10, color: '#c7d2fe' }}
                >
                    <span>W</span>
                    <input
                        type="number"
                        defaultValue={dispW}
                        key={dispW}
                        onBlur={e => handleWChange(e.target.value)}
                        style={{ width: 40, background: 'transparent', border: '1px solid #4338ca',
                            borderRadius: 2, color: '#e0e7ff', fontSize: 10, padding: '0 2px' }}
                    />
                    <span>H</span>
                    <input
                        type="number"
                        defaultValue={dispH}
                        key={`h${dispH}`}
                        onBlur={e => handleHChange(e.target.value)}
                        style={{ width: 40, background: 'transparent', border: '1px solid #4338ca',
                            borderRadius: 2, color: '#e0e7ff', fontSize: 10, padding: '0 2px' }}
                    />
                    <span>°</span>
                    <input
                        type="number"
                        defaultValue={dispRot}
                        key={`r${dispRot}`}
                        onBlur={e => handleRotChange(e.target.value)}
                        style={{ width: 36, background: 'transparent', border: '1px solid #4338ca',
                            borderRadius: 2, color: '#e0e7ff', fontSize: 10, padding: '0 2px' }}
                    />
                </div>
            </foreignObject>
        </svg>
    )
}
