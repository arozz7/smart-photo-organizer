/**
 * Phase 119 — Mask Editor: pure-function tests for canvas geometry and undo/redo
 */
import { describe, it, expect } from 'vitest'

import { computeCanvasTransform, toImageCoords } from '../../../src/components/canvasHelpers'
import { INITIAL_STATE } from '../../../src/types/segmentation'
import type { SegmentState, MaskResult } from '../../../src/types/segmentation'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<SegmentState> = {}): SegmentState {
    return { ...INITIAL_STATE, ...overrides }
}

function makeMask(b64: string): MaskResult {
    return { mask_b64: b64, score: 1.0, area: 100 }
}

// ---------------------------------------------------------------------------
// computeCanvasTransform + toImageCoords at various zoom levels
// ---------------------------------------------------------------------------

describe('computeCanvasTransform', () => {
    const NW = 800   // image natural width
    const NH = 600   // image natural height
    const CW = 680   // canvas width
    const CH = 480   // canvas height

    it('zoom=1 fits image to canvas', () => {
        const t = computeCanvasTransform(NW, NH, CW, CH)
        expect(t.scale).toBeCloseTo(Math.min(CW / NW, CH / NH))
        expect(t.renderedW).toBeCloseTo(NW * t.scale)
        expect(t.renderedH).toBeCloseTo(NH * t.scale)
        // Should be centred
        expect(t.offsetX).toBeCloseTo((CW - t.renderedW) / 2)
        expect(t.offsetY).toBeCloseTo((CH - t.renderedH) / 2)
    })

    it('zoom=2 doubles rendered size', () => {
        const t1 = computeCanvasTransform(NW, NH, CW, CH, 1)
        const t2 = computeCanvasTransform(NW, NH, CW, CH, 2)
        expect(t2.scale).toBeCloseTo(t1.scale * 2)
        expect(t2.renderedW).toBeCloseTo(t1.renderedW * 2)
        expect(t2.renderedH).toBeCloseTo(t1.renderedH * 2)
    })

    it('pan shifts offsetX/offsetY', () => {
        const t = computeCanvasTransform(NW, NH, CW, CH, 1, 20, -10)
        const tb = computeCanvasTransform(NW, NH, CW, CH, 1)
        expect(t.offsetX).toBeCloseTo(tb.offsetX + 20)
        expect(t.offsetY).toBeCloseTo(tb.offsetY - 10)
        expect(t.scale).toBeCloseTo(tb.scale)
    })
})

describe('toImageCoords', () => {
    const NW = 800
    const NH = 600
    const CW = 680
    const CH = 480

    it('round-trips at zoom=1', () => {
        const t = computeCanvasTransform(NW, NH, CW, CH, 1)
        const canvasX = t.offsetX + 400 * t.scale
        const canvasY = t.offsetY + 300 * t.scale
        const { x, y } = toImageCoords(canvasX, canvasY, t)
        expect(x).toBe(400)
        expect(y).toBe(300)
    })

    it('round-trips at zoom=2', () => {
        const t = computeCanvasTransform(NW, NH, CW, CH, 2)
        const canvasX = t.offsetX + 200 * t.scale
        const canvasY = t.offsetY + 150 * t.scale
        const { x, y } = toImageCoords(canvasX, canvasY, t)
        expect(x).toBe(200)
        expect(y).toBe(150)
    })

    it('round-trips at zoom=0.5', () => {
        const t = computeCanvasTransform(NW, NH, CW, CH, 0.5)
        const canvasX = t.offsetX + 600 * t.scale
        const canvasY = t.offsetY + 400 * t.scale
        const { x, y } = toImageCoords(canvasX, canvasY, t)
        expect(x).toBe(600)
        expect(y).toBe(400)
    })

    it('round-trips with non-zero pan', () => {
        const t = computeCanvasTransform(NW, NH, CW, CH, 1.5, 30, -20)
        const imgPx = { x: 350, y: 250 }
        const canvasX = t.offsetX + imgPx.x * t.scale
        const canvasY = t.offsetY + imgPx.y * t.scale
        const { x, y } = toImageCoords(canvasX, canvasY, t)
        expect(x).toBe(imgPx.x)
        expect(y).toBe(imgPx.y)
    })
})

// ---------------------------------------------------------------------------
// Undo / redo pure-state logic (mirrors useSegmentation setState lambdas)
// ---------------------------------------------------------------------------

function applyMaskEdit(s: SegmentState, newMaskB64: string): SegmentState {
    const prevMaskB64 = s.masks[s.selectedMaskIdx]?.mask_b64 ?? ''
    const masks = s.masks.map((m, i) =>
        i === s.selectedMaskIdx ? { ...m, mask_b64: newMaskB64 } : m
    )
    return {
        ...s,
        masks,
        resultB64: null,
        maskHistory: [...s.maskHistory.slice(-19), prevMaskB64],
        maskFuture: [],
    }
}

function undoMask(s: SegmentState): SegmentState {
    if (s.maskHistory.length === 0) return s
    const prev    = s.maskHistory[s.maskHistory.length - 1]
    const current = s.masks[s.selectedMaskIdx]?.mask_b64 ?? ''
    const masks   = s.masks.map((m, i) => i === s.selectedMaskIdx ? { ...m, mask_b64: prev } : m)
    return {
        ...s, masks, resultB64: null,
        maskHistory: s.maskHistory.slice(0, -1),
        maskFuture:  [current, ...s.maskFuture],
    }
}

function redoMask(s: SegmentState): SegmentState {
    if (s.maskFuture.length === 0) return s
    const next    = s.maskFuture[0]
    const current = s.masks[s.selectedMaskIdx]?.mask_b64 ?? ''
    const masks   = s.masks.map((m, i) => i === s.selectedMaskIdx ? { ...m, mask_b64: next } : m)
    return {
        ...s, masks, resultB64: null,
        maskHistory: [...s.maskHistory, current],
        maskFuture:  s.maskFuture.slice(1),
    }
}

describe('mask undo/redo state logic', () => {
    it('applyMaskEdit pushes old mask to history', () => {
        const s0 = makeState({ masks: [makeMask('aaa')], selectedMaskIdx: 0 })
        const s1 = applyMaskEdit(s0, 'bbb')
        expect(s1.masks[0].mask_b64).toBe('bbb')
        expect(s1.maskHistory).toEqual(['aaa'])
        expect(s1.maskFuture).toEqual([])
        expect(s1.resultB64).toBeNull()
    })

    it('undoMask restores previous snapshot', () => {
        const s0 = makeState({ masks: [makeMask('aaa')], selectedMaskIdx: 0 })
        const s1 = applyMaskEdit(s0, 'bbb')
        const s2 = undoMask(s1)
        expect(s2.masks[0].mask_b64).toBe('aaa')
        expect(s2.maskHistory).toEqual([])
        expect(s2.maskFuture).toEqual(['bbb'])
    })

    it('redoMask reapplies undone edit', () => {
        const s0 = makeState({ masks: [makeMask('aaa')], selectedMaskIdx: 0 })
        const s1 = applyMaskEdit(s0, 'bbb')
        const s2 = undoMask(s1)
        const s3 = redoMask(s2)
        expect(s3.masks[0].mask_b64).toBe('bbb')
        expect(s3.maskHistory).toEqual(['aaa'])
        expect(s3.maskFuture).toEqual([])
    })

    it('undoMask is a no-op when history is empty', () => {
        const s0 = makeState({ masks: [makeMask('aaa')], selectedMaskIdx: 0 })
        const s1 = undoMask(s0)
        expect(s1).toBe(s0)
    })

    it('redoMask is a no-op when future is empty', () => {
        const s0 = makeState({ masks: [makeMask('aaa')], selectedMaskIdx: 0 })
        const s1 = redoMask(s0)
        expect(s1).toBe(s0)
    })

    it('applyMaskEdit caps history at 20 entries', () => {
        let s = makeState({ masks: [makeMask('seed')], selectedMaskIdx: 0 })
        for (let i = 0; i < 25; i++) s = applyMaskEdit(s, `frame-${i}`)
        expect(s.maskHistory.length).toBe(20)
    })

    it('applyMaskEdit clears future (non-linear edit)', () => {
        const s0 = makeState({ masks: [makeMask('aaa')], selectedMaskIdx: 0 })
        const s1 = applyMaskEdit(s0, 'bbb')
        const s2 = undoMask(s1)            // future = ['bbb']
        const s3 = applyMaskEdit(s2, 'ccc') // new branch — future must be cleared
        expect(s3.maskFuture).toEqual([])
        expect(s3.masks[0].mask_b64).toBe('ccc')
    })

    it('multi-mask state — only selected mask changes', () => {
        const s0 = makeState({
            masks: [makeMask('m0'), makeMask('m1')],
            selectedMaskIdx: 1,
        })
        const s1 = applyMaskEdit(s0, 'edited')
        expect(s1.masks[0].mask_b64).toBe('m0')   // untouched
        expect(s1.masks[1].mask_b64).toBe('edited')
        expect(s1.maskHistory[0]).toBe('m1')
    })
})
