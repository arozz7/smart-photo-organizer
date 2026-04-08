/**
 * Phase 118 — useCompositor.updateLayerTransform tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => 'C:\\tmp') },
    ipcMain: { handle: vi.fn() },
}))

// We test the hook logic in isolation — no IPC needed for these unit tests.
// The hook calls window.ipcRenderer.invoke internally; we just need the
// updateLayerTransform → updateLayer → scheduleFlatten chain to work.

// ── Pure-logic tests (no React) ───────────────────────────────────────────────

import { computeHandles, rotatePoint, snapAngle } from '../../../src/components/TransformBox'
import type { LayerSpec } from '../../../src/types/compositor'

function makeLayer(overrides: Partial<LayerSpec> = {}): LayerSpec {
    return {
        id: 'l1',
        name: 'Test',
        sourceImageB64: '',
        maskB64: '',
        x: 100,
        y: 50,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        sourceWidth: 200,
        sourceHeight: 100,
        opacity: 1,
        zIndex: 0,
        visible: true,
        ...overrides,
    }
}

describe('rotatePoint', () => {
    it('returns the same point when angle is 0', () => {
        const [rx, ry] = rotatePoint(10, 20, 0, 0, 0)
        expect(rx).toBeCloseTo(10)
        expect(ry).toBeCloseTo(20)
    })

    it('rotates 90° clockwise around origin', () => {
        // Rotating (1,0) around (0,0) by 90° CW → (0,1)
        const [rx, ry] = rotatePoint(1, 0, 0, 0, 90)
        expect(rx).toBeCloseTo(0)
        expect(ry).toBeCloseTo(1)
    })

    it('rotates 180° around a custom centroid', () => {
        // Rotating (10,0) around (5,0) by 180° → (0,0)
        const [rx, ry] = rotatePoint(10, 0, 5, 0, 180)
        expect(rx).toBeCloseTo(0)
        expect(ry).toBeCloseTo(0)
    })
})

describe('snapAngle', () => {
    it('snaps 7° to 0°', () => expect(snapAngle(7)).toBe(0))
    it('snaps 8° to 15°', () => expect(snapAngle(8)).toBe(15))
    it('snaps 22° to 15°', () => expect(snapAngle(22)).toBe(15))
    it('snaps 23° to 30°', () => expect(snapAngle(23)).toBe(30))
    it('handles negative angles', () => expect(snapAngle(-8)).toBe(-15))
    it('handles negative 9°', () => expect(snapAngle(-9)).toBe(-15))
})

describe('computeHandles — identity transform', () => {
    const layer = makeLayer() // x=100,y=50, scaleX=1,scaleY=1, rot=0, w=200, h=100

    it('computes centroid correctly', () => {
        const { cx, cy } = computeHandles(layer)
        expect(cx).toBe(200) // 100 + 200/2
        expect(cy).toBe(100) // 50 + 100/2
    })

    it('tl is at layer origin', () => {
        const { tl } = computeHandles(layer)
        expect(tl[0]).toBeCloseTo(100)
        expect(tl[1]).toBeCloseTo(50)
    })

    it('br is at layer bottom-right', () => {
        const { br } = computeHandles(layer)
        expect(br[0]).toBeCloseTo(300) // 100 + 200
        expect(br[1]).toBeCloseTo(150) // 50 + 100
    })

    it('tm is at top-center', () => {
        const { tm } = computeHandles(layer)
        expect(tm[0]).toBeCloseTo(200) // 100 + 100
        expect(tm[1]).toBeCloseTo(50)
    })
})

describe('computeHandles — scaled layer', () => {
    const layer = makeLayer({ scaleX: 2, scaleY: 0.5 })
    // Effective size: 400 × 50

    it('computes width/height from scale', () => {
        const { w, h } = computeHandles(layer)
        expect(w).toBeCloseTo(400)
        expect(h).toBeCloseTo(50)
    })

    it('br reflects scaled dims', () => {
        const { br } = computeHandles(layer)
        expect(br[0]).toBeCloseTo(500) // 100 + 400
        expect(br[1]).toBeCloseTo(100) // 50 + 50
    })
})

describe('computeHandles — 90° rotation', () => {
    const layer = makeLayer({ rotation: 90 })
    // w=200, h=100, cx=200, cy=100

    it('tl rotates to bottom-left of unrotated box', () => {
        // Unrotated tl=(100,50), rotated 90° around (200,100)
        // dx=-100, dy=-50 → rotated dx=50, dy=-100 → (250, 0)
        const { tl } = computeHandles(layer)
        expect(tl[0]).toBeCloseTo(250)
        expect(tl[1]).toBeCloseTo(0)
    })
})

describe('computeHandles — negative scale (flip)', () => {
    const layer = makeLayer({ scaleX: -1 })

    it('w is the absolute value of scaled width', () => {
        const { w } = computeHandles(layer)
        expect(w).toBe(200)
    })
})
