/**
 * Shared types for Photo Adjustments (Phase 117).
 *
 * Used by:
 *   - src/hooks/useSegmentation.ts
 *   - src/components/AdjustmentsPanel.tsx
 *   - src/views/Compose.tsx
 */

/** All adjustment controls — all fields are optional; omitted = identity (no change). */
export interface AdjustmentParams {
    /** Color temperature: -1.0 (cool/blue) → +1.0 (warm/orange). Default 0. */
    temperature?: number;
    /** Input levels minimum: pixels at or below this value map to 0. Range 0–200. Default 0. */
    blackPoint?: number;
    /** Input levels maximum: pixels at or above this value map to 255. Range 55–255. Default 255. */
    whitePoint?: number;
    /** Brightness multiplier. 0.0 = black, 1.0 = unchanged, 2.0 = double. Default 1. */
    brightness?: number;
    /** Contrast multiplier. 0.0 = flat grey, 1.0 = unchanged, 2.0 = high contrast. Default 1. */
    contrast?: number;
    /** Shadow lift: +1.0 lifts dark tones, -1.0 crushes them. Default 0. */
    shadows?: number;
    /** Highlight compression: +1.0 pulls bright tones down, -1.0 lifts them. Default 0. */
    highlights?: number;
}

/** Where adjustments are applied relative to the active mask. */
export type AdjustmentScope = 'global' | 'segment';

/** Default values for all adjustment params (identity — no change). */
export const DEFAULT_ADJUSTMENT_PARAMS: Required<AdjustmentParams> = {
    temperature: 0,
    blackPoint:  0,
    whitePoint:  255,
    brightness:  1,
    contrast:    1,
    shadows:     0,
    highlights:  0,
};

/**
 * Convert camelCase AdjustmentParams to the snake_case dict expected by Python.
 * Only includes keys that are defined (undefined keys keep Python defaults).
 */
export function toSnakeAdjustParams(p: AdjustmentParams): Record<string, number> {
    const out: Record<string, number> = {};
    if (p.temperature !== undefined) out.temperature = p.temperature;
    if (p.blackPoint  !== undefined) out.black_point = p.blackPoint;
    if (p.whitePoint  !== undefined) out.white_point = p.whitePoint;
    if (p.brightness  !== undefined) out.brightness  = p.brightness;
    if (p.contrast    !== undefined) out.contrast    = p.contrast;
    if (p.shadows     !== undefined) out.shadows     = p.shadows;
    if (p.highlights  !== undefined) out.highlights  = p.highlights;
    return out;
}
