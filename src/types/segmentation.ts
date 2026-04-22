export type PromptMode = 'text' | 'box' | 'points' | 'exemplar'
export type Operation =
    | 'background-remove' | 'isolate' | 'blur' | 'enhance'
    | 'desaturate-bg' | 'fill-bg'
    | 'pixelate-bg' | 'spotlight' | 'color-tint'
    | 'adjust'

export type { AdjustmentParams, AdjustmentScope } from './adjustments'

export interface MaskResult {
    mask_b64: string
    score: number
    area: number
}

export interface Capabilities {
    model_ready: boolean
    text_prompts: boolean
    provider: string
    checkpoint?: string
    model_file_present?: boolean
    transformers_compatible?: boolean
    install_hint?: string
    error?: string
}

export interface PointPrompt {
    x: number
    y: number
    label: 1 | 0
}

export interface LastOp {
    operation: Operation
    extra?: {
        radius?: number
        color?: string
        pixelSize?: number
        spotlightBrightness?: number
        tintOpacity?: number
    }
}

export interface SegmentState {
    capabilities: Capabilities | null
    sessionId: string | null
    imagePath: string | null
    promptMode: PromptMode
    text: string
    points: PointPrompt[]
    box: [number, number, number, number] | null
    exemplarBox: [number, number, number, number] | null
    exemplarNegBoxes: [number, number, number, number][]
    masks: MaskResult[]
    selectedMaskIdx: number
    resultB64: string | null
    isPredicting: boolean
    isApplying: boolean
    isLoadingImage: boolean
    error: string | null
    textThreshold: number
    maskThreshold: number
    featherRadius: number
    invertSelection: boolean
    lastOp: LastOp | null
    // Phase 119
    editingMask: boolean
    maskHistory: string[]
    maskFuture: string[]
}

export type PredictOverride = {
    points?: PointPrompt[]
    box?: [number, number, number, number] | null
    text?: string
    exemplarBox?: [number, number, number, number] | null
    exemplarNegBoxes?: [number, number, number, number][]
}

export const INITIAL_STATE: SegmentState = {
    capabilities: null,
    sessionId: null,
    imagePath: null,
    promptMode: 'text',
    text: '',
    points: [],
    box: null,
    exemplarBox: null,
    exemplarNegBoxes: [],
    masks: [],
    selectedMaskIdx: 0,
    resultB64: null,
    isPredicting: false,
    isApplying: false,
    isLoadingImage: false,
    error: null,
    textThreshold: 0.5,
    maskThreshold: 0.5,
    featherRadius: 0,
    invertSelection: false,
    lastOp: null,
    editingMask: false,
    maskHistory: [],
    maskFuture: [],
}
