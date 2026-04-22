import { useState, useCallback } from 'react'
import { AdjustmentParams, AdjustmentScope, DEFAULT_ADJUSTMENT_PARAMS } from '../types/adjustments'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
    /** Base64-encoded PNG/JPEG of the image to adjust. null = Apply disabled. */
    imageB64:      string | null
    /** Whether an active mask is selected — shows scope selector when true. */
    hasMask:       boolean
    scope:         AdjustmentScope
    onScopeChange: (scope: AdjustmentScope) => void
    busy:          boolean
    onApply:       (imageB64: string, params: AdjustmentParams, scope: AdjustmentScope) => void
}

// ---------------------------------------------------------------------------
// Slider config
// ---------------------------------------------------------------------------

interface SliderDef {
    key:     keyof AdjustmentParams
    label:   string
    min:     number
    max:     number
    step:    number
    default: number
    format?: (v: number) => string
}

const SLIDERS: SliderDef[] = [
    {
        key:     'temperature',
        label:   'Temp (WB)',
        min:     -1, max: 1, step: 0.05,
        default: 0,
        // Map -1..+1 to approximate Kelvin: 3000K (cool) → 10000K (warm), neutral = 6500K
        format:  v => `${Math.round(6500 + v * 3500)}K`,
    },
    { key: 'blackPoint',  label: 'Black Point',  min: 0,   max: 200, step: 1,    default: 0   },
    { key: 'whitePoint',  label: 'White Point',  min: 55,  max: 255, step: 1,    default: 255 },
    { key: 'brightness',  label: 'Brightness',   min: 0,   max: 2,   step: 0.05, default: 1   },
    { key: 'contrast',    label: 'Contrast',     min: 0,   max: 2,   step: 0.05, default: 1   },
    { key: 'shadows',     label: 'Shadows',      min: -1,  max: 1,   step: 0.05, default: 0   },
    { key: 'highlights',  label: 'Highlights',   min: -1,  max: 1,   step: 0.05, default: 0   },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdjustmentsPanel({
    imageB64, hasMask, scope, onScopeChange, busy, onApply,
}: Props) {
    const [expanded, setExpanded] = useState(false)
    const [params, setParams] = useState<Required<AdjustmentParams>>({ ...DEFAULT_ADJUSTMENT_PARAMS })

    const updateParam = useCallback(<K extends keyof AdjustmentParams>(key: K, value: number) => {
        setParams(p => ({ ...p, [key]: value }))
    }, [])

    const resetParam = useCallback((key: keyof AdjustmentParams, defaultVal: number) => {
        setParams(p => ({ ...p, [key]: defaultVal }))
    }, [])

    const resetAll = useCallback(() => {
        setParams({ ...DEFAULT_ADJUSTMENT_PARAMS })
    }, [])

    const handleApply = useCallback(() => {
        if (!imageB64 || busy) return
        onApply(imageB64, params, scope)
    }, [imageB64, busy, params, scope, onApply])

    const canApply = !!imageB64 && !busy

    return (
        <div className="border-t border-gray-700 flex-shrink-0">
            {/* Header */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-800/60 transition-colors"
                aria-expanded={expanded}
                aria-controls="adjustments-panel-body"
            >
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Adjustments
                </span>
                <span className="text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div id="adjustments-panel-body" className="px-4 pb-4 space-y-3">
                    {/* Scope selector — only visible when a mask is active */}
                    {hasMask && (
                        <div className="flex gap-2 pt-1">
                            {(['global', 'segment'] as AdjustmentScope[]).map(s => (
                                <button
                                    key={s}
                                    onClick={() => onScopeChange(s)}
                                    className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                                        scope === s
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                    aria-pressed={scope === s}
                                >
                                    {s === 'global' ? 'Global' : 'Segment'}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Sliders */}
                    <div className="space-y-2.5">
                        {SLIDERS.map(def => {
                            const value = params[def.key] as number
                            const displayValue = def.format
                                ? def.format(value)
                                : def.step < 1
                                    ? value.toFixed(2)
                                    : String(value)
                            const isDefault = value === def.default

                            return (
                                <div key={def.key} className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400 w-20 flex-shrink-0 truncate" title={def.label}>
                                        {def.label}
                                    </span>
                                    <input
                                        type="range"
                                        min={def.min}
                                        max={def.max}
                                        step={def.step}
                                        value={value}
                                        onChange={e => updateParam(def.key, Number(e.target.value))}
                                        className="flex-1 accent-indigo-500 h-1"
                                        aria-label={`${def.label}: ${displayValue}`}
                                    />
                                    <span className="text-xs text-gray-300 w-14 tabular-nums text-right flex-shrink-0">
                                        {displayValue}
                                    </span>
                                    <button
                                        onClick={() => resetParam(def.key, def.default)}
                                        disabled={isDefault}
                                        className="text-gray-600 hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                                        title={`Reset ${def.label} to default`}
                                        aria-label={`Reset ${def.label}`}
                                    >
                                        ×
                                    </button>
                                </div>
                            )
                        })}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={handleApply}
                            disabled={!canApply}
                            className="flex-1 py-1.5 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                            aria-label="Apply adjustments"
                        >
                            {busy ? 'Applying…' : 'Apply Adjustments'}
                        </button>
                        <button
                            onClick={resetAll}
                            className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 transition-colors"
                            aria-label="Reset all adjustments"
                        >
                            Reset All
                        </button>
                    </div>

                    {!imageB64 && (
                        <p className="text-xs text-gray-600 text-center">
                            Load an image to enable adjustments
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
