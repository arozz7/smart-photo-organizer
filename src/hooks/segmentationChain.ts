import type { Operation, ActiveOp, OpExtra, LastAdjustment } from '../types/segmentation'
import type { AdjustmentParams, AdjustmentScope } from '../types/adjustments'

export type { ActiveOp, OpExtra, LastAdjustment }

// Canonical execution order — bg effects first, subject sharpening last.
export const OP_ORDER: Operation[] = [
    'background-remove', 'isolate', 'desaturate-bg', 'blur',
    'pixelate-bg', 'spotlight', 'fill-bg', 'color-tint', 'enhance',
]

// Operations that are mutually exclusive (only one active at a time).
export const BG_OPS = new Set<Operation>([
    'background-remove', 'isolate', 'desaturate-bg', 'blur',
    'pixelate-bg', 'spotlight', 'fill-bg', 'color-tint',
])

export function sortActiveOps(ops: ActiveOp[]): ActiveOp[] {
    return [...ops].sort((a, b) => OP_ORDER.indexOf(a.operation) - OP_ORDER.indexOf(b.operation))
}

type InvokeFn = (channel: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>

function buildOpPayload(
    op: ActiveOp,
    sessionId: string,
    maskB64: string,
    invertMask: boolean,
    featherRadius: number,
    sourceb64?: string,
): Record<string, unknown> {
    const p: Record<string, unknown> = {
        session_id: sessionId,
        operation: op.operation,
        mask_b64: maskB64,
        invert_mask: invertMask,
        feather_radius: featherRadius,
    }
    if (sourceb64) p.source_image_b64 = sourceb64
    const x = op.extra
    if (!x) return p
    if (x.radius !== undefined)             p.radius = x.radius
    if (x.color !== undefined)              p.color = x.color
    if (x.pixelSize !== undefined)          p.pixel_size = x.pixelSize
    if (x.spotlightBrightness !== undefined) p.brightness = x.spotlightBrightness
    if (x.tintOpacity !== undefined)        p.tint_opacity = x.tintOpacity
    if (x.enhanceOpacity !== undefined)     p.enhance_opacity = x.enhanceOpacity
    if (x.enhanceThreshold !== undefined)   p.enhance_threshold = x.enhanceThreshold
    return p
}

/** Run all ops in canonical order, chaining results. Returns the final result_b64. */
export async function runOpsIPC(
    invoke: InvokeFn,
    ops: ActiveOp[],
    sessionId: string,
    maskB64: string,
    invertMask: boolean,
    featherRadius: number,
): Promise<string> {
    const sorted = sortActiveOps(ops)
    let currentB64: string | undefined = undefined
    for (const op of sorted) {
        const payload = buildOpPayload(op, sessionId, maskB64, invertMask, featherRadius, currentB64)
        const res = await invoke('ai:segment:apply', payload)
        if (!res?.success) throw new Error((res?.error as string) ?? 'Apply failed')
        currentB64 = res.result_b64 as string
    }
    return currentB64!
}

/** Run the adjustments IPC call. Returns result_b64. */
export async function runAdjustmentIPC(
    invoke: InvokeFn,
    sourceB64: string,
    params: AdjustmentParams,
    scope: AdjustmentScope,
    maskB64: string | undefined,
    invertMask: boolean,
    featherRadius: number,
): Promise<string> {
    const { toSnakeAdjustParams } = await import('../types/adjustments')
    const payload: Record<string, unknown> = {
        image_b64: sourceB64,
        scope,
        invert_mask: invertMask,
        feather_radius: featherRadius,
        params: toSnakeAdjustParams(params),
    }
    if (maskB64) payload.mask_b64 = maskB64
    const res = await invoke('ai:segment:adjust', payload)
    if (!res?.success) throw new Error((res?.error as string) ?? 'Adjustment failed')
    return res.result_b64 as string
}

export type { AdjustmentParams, AdjustmentScope }

// ---------------------------------------------------------------------------
// Mask union helper (used by useSegmentation.unionAllMasks)
// ---------------------------------------------------------------------------

function loadMaskImage(b64: string): Promise<HTMLImageElement> {
    return new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.src = `data:image/png;base64,${b64}`
    })
}

export interface MaskResult {
    mask_b64: string
    score: number
    area: number
}

/** Union all mask images via canvas lighten-blend. Returns null if ≤1 mask. */
export async function computeUnionMask(
    masks: MaskResult[],
): Promise<{ mask_b64: string; area: number } | null> {
    if (masks.length <= 1) return null

    const imgs   = await Promise.all(masks.map(m => loadMaskImage(m.mask_b64)))
    const canvas = document.createElement('canvas')
    canvas.width  = imgs[0].naturalWidth
    canvas.height = imgs[0].naturalHeight
    const ctx    = canvas.getContext('2d')!

    ctx.drawImage(imgs[0], 0, 0)
    ctx.globalCompositeOperation = 'lighten'
    for (let i = 1; i < imgs.length; i++) ctx.drawImage(imgs[i], 0, 0)

    const mask_b64  = canvas.toDataURL('image/png').split(',')[1]
    const area      = masks.reduce((sum, m) => sum + m.area, 0)
    return { mask_b64, area }
}
