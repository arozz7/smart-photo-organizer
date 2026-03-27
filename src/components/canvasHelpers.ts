/**
 * Pure geometry helpers for the CreativeToolsPanel canvas interactions.
 * No React or DOM dependencies — all functions are deterministic given inputs.
 */
import type { PointPrompt } from '../hooks/useSegmentation'

export interface CanvasTransform {
    scale: number
    offsetX: number
    offsetY: number
    renderedW: number
    renderedH: number
}

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Discriminated union for the active canvas drag action. */
export type DragAction =
    | { type: 'none' }
    | { type: 'draw-box'; startCX: number; startCY: number }
    | { type: 'move-box'; startCX: number; startCY: number; origBox: [number, number, number, number] }
    | { type: 'resize-box'; handle: BoxHandle; startCX: number; startCY: number; origBox: [number, number, number, number] }
    | { type: 'move-point'; index: number; startCX: number; startCY: number; origPt: PointPrompt }

const HANDLE_ORDER: BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const HANDLE_CURSORS: Record<BoxHandle, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    w: 'w-resize',                   e: 'e-resize',
    sw: 'sw-resize', s: 's-resize', se: 'se-resize',
}

export function toImageCoords(cx: number, cy: number, t: CanvasTransform): { x: number; y: number } {
    return { x: Math.round((cx - t.offsetX) / t.scale), y: Math.round((cy - t.offsetY) / t.scale) }
}

export function isInsideImage(cx: number, cy: number, t: CanvasTransform): boolean {
    return cx >= t.offsetX && cy >= t.offsetY && cx <= t.offsetX + t.renderedW && cy <= t.offsetY + t.renderedH
}

export function getBoxHandlePositions(
    box: [number, number, number, number],
    t: CanvasTransform,
): Record<BoxHandle, { cx: number; cy: number }> {
    const [x1, y1, x2, y2] = box
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const c = (ix: number, iy: number) => ({ cx: t.offsetX + ix * t.scale, cy: t.offsetY + iy * t.scale })
    return {
        nw: c(x1, y1), n: c(mx, y1), ne: c(x2, y1),
        w: c(x1, my),                 e: c(x2, my),
        sw: c(x1, y2), s: c(mx, y2), se: c(x2, y2),
    }
}

export function hitTestHandle(
    cx: number, cy: number,
    box: [number, number, number, number],
    t: CanvasTransform,
    hitR = 10,
): BoxHandle | null {
    const handles = getBoxHandlePositions(box, t)
    for (const h of HANDLE_ORDER) {
        if (Math.abs(cx - handles[h].cx) <= hitR && Math.abs(cy - handles[h].cy) <= hitR) return h
    }
    return null
}

export function hitTestPoint(
    cx: number, cy: number,
    points: PointPrompt[],
    t: CanvasTransform,
    hitR = 10,
): number | null {
    for (let i = 0; i < points.length; i++) {
        const p = points[i]
        if (Math.hypot(cx - (t.offsetX + p.x * t.scale), cy - (t.offsetY + p.y * t.scale)) <= hitR) return i
    }
    return null
}

export function isInsideBox(cx: number, cy: number, box: [number, number, number, number], t: CanvasTransform): boolean {
    const [x1, y1, x2, y2] = box
    return cx >= t.offsetX + x1 * t.scale && cx <= t.offsetX + x2 * t.scale
        && cy >= t.offsetY + y1 * t.scale && cy <= t.offsetY + y2 * t.scale
}

export function applyResizeHandle(
    handle: BoxHandle,
    box: [number, number, number, number],
    dx: number, dy: number,
    t: CanvasTransform,
): [number, number, number, number] {
    const dxi = dx / t.scale
    const dyi = dy / t.scale
    let [x1, y1, x2, y2] = box
    if (handle.includes('w')) x1 = Math.min(x1 + dxi, x2 - 1)
    if (handle.includes('e')) x2 = Math.max(x2 + dxi, x1 + 1)
    if (handle.includes('n')) y1 = Math.min(y1 + dyi, y2 - 1)
    if (handle.includes('s')) y2 = Math.max(y2 + dyi, y1 + 1)
    return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]
}

export function getCursorForHandle(handle: BoxHandle): string {
    return HANDLE_CURSORS[handle]
}
