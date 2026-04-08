/**
 * Shared TypeScript types for the Creative Compositing Workspace (Phase 116).
 *
 * Used by:
 *   - src/hooks/useCompositor.ts
 *   - src/views/Compose.tsx
 *   - src/components/LayerRow.tsx
 *   - electron/ipc/compositeHandlers.ts (loosely via payload shape)
 */

/** Transform fields shared between LayerSpec and useCompositor.updateLayerTransform. */
export interface LayerTransform {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
}

/** Full specification of a single compositor layer. */
export interface LayerSpec extends LayerTransform {
    /** Unique identifier (UUID). */
    id: string;
    /** Human-readable display name (editable). */
    name: string;
    /** Base64-encoded PNG/JPEG of the full source image. */
    sourceImageB64: string;
    /**
     * Base64-encoded grayscale PNG mask.
     * White pixels = subject (opaque), black pixels = background (transparent).
     * Provide an empty string for un-masked (full-image) layers.
     */
    maskB64: string;
    /** Pixel offset of this layer's top-left corner on the canvas. */
    x: number;
    y: number;
    /** Scale factors — 1.0 = natural size. */
    scaleX: number;
    scaleY: number;
    /** Clockwise rotation in degrees. */
    rotation: number;
    /** Natural pixel dimensions of the source image — used to draw the TransformBox. */
    sourceWidth: number;
    sourceHeight: number;
    /** Layer opacity, 0.0 (transparent) → 1.0 (opaque). */
    opacity: number;
    /** Compositing order. Layers with lower zIndex render below higher zIndex. */
    zIndex: number;
    /** When false the layer is skipped during compositing and hidden in the UI. */
    visible: boolean;
}

/** Payload for the "Send to Compose" action from Creative Tools. */
export interface SendToComposePayload {
    /** Base64-encoded full source image. */
    sourceImageB64: string;
    /** Base64-encoded grayscale mask PNG from the active segmentation result. */
    maskB64: string;
    /** Suggested display name for the new layer. */
    suggestedName?: string;
    /** Natural pixel dimensions of the source image (for TransformBox). */
    sourceWidth?: number;
    sourceHeight?: number;
}

/** State managed by useCompositor. */
export interface CompositorState {
    layers: LayerSpec[];
    canvasWidth: number;
    canvasHeight: number;
    resultB64: string | null;
    isCompositing: boolean;
    error: string | null;
}
