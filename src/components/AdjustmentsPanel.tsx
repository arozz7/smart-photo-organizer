import { useState, useCallback, useEffect, useRef } from 'react'
import { AdjustmentParams, AdjustmentScope, DEFAULT_ADJUSTMENT_PARAMS } from '../types/adjustments'

interface Props {
    imageB64:        string | null
    hasMask:         boolean
    scope:           AdjustmentScope
    onScopeChange:   (scope: AdjustmentScope) => void
    busy:            boolean
    onApply:         (imageB64: string, params: AdjustmentParams, scope: AdjustmentScope) => void
    /** Controlled params — lifted from parent to survive panel open/close cycles */
    params?:         Required<AdjustmentParams>
    onParamsChange?: (params: Required<AdjustmentParams>) => void
    /** When true: debounced auto-apply on every change; no Apply button shown */
    autoApply?:      boolean
}

interface SliderDef {
    key:     keyof AdjustmentParams
    label:   string
    short:   string
    min:     number
    max:     number
    step:    number
    default: number
    format?: (v: number) => string
}

const SLIDERS: SliderDef[] = [
    { key: 'temperature', label: 'Temperature', short: 'Temp',   min: -1,  max: 1,   step: 0.05, default: 0,   format: v => `${Math.round(6500 + v * 3500)}K` },
    { key: 'blackPoint',  label: 'Black Point',  short: 'Black',  min: 0,   max: 200, step: 1,    default: 0   },
    { key: 'whitePoint',  label: 'White Point',  short: 'White',  min: 55,  max: 255, step: 1,    default: 255 },
    { key: 'brightness',  label: 'Brightness',   short: 'Bright', min: 0,   max: 2,   step: 0.05, default: 1   },
    { key: 'contrast',    label: 'Contrast',     short: 'Contr',  min: 0,   max: 2,   step: 0.05, default: 1   },
    { key: 'shadows',     label: 'Shadows',      short: 'Shdws',  min: -1,  max: 1,   step: 0.05, default: 0   },
    { key: 'highlights',  label: 'Highlights',   short: 'Hi-lts', min: -1,  max: 1,   step: 0.05, default: 0   },
]

export default function AdjustmentsPanel({
    imageB64, hasMask, scope, onScopeChange, busy, onApply,
    params: propParams, onParamsChange, autoApply = false,
}: Props) {
    // Uncontrolled fallback state (used when props.params is not provided)
    const [internalParams, setInternalParams] = useState<Required<AdjustmentParams>>({ ...DEFAULT_ADJUSTMENT_PARAMS })
    const params  = propParams ?? internalParams
    const setParam = useCallback((key: keyof AdjustmentParams, value: number) => {
        const next = { ...params, [key]: value }
        if (onParamsChange) onParamsChange(next)
        else setInternalParams(next)
    }, [params, onParamsChange])
    const resetAll = useCallback(() => {
        const next = { ...DEFAULT_ADJUSTMENT_PARAMS }
        if (onParamsChange) onParamsChange(next)
        else setInternalParams(next)
    }, [onParamsChange])

    // ------------------------------------------------------------------
    // Auto-apply (debounced) — only active when autoApply=true
    // ------------------------------------------------------------------
    const imageB64Ref  = useRef(imageB64)
    const busyRef      = useRef(busy)
    const paramsRef    = useRef(params)
    const scopeRef     = useRef(scope)
    const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const didMountRef  = useRef(false)

    useEffect(() => {
        imageB64Ref.current = imageB64
        busyRef.current     = busy
        paramsRef.current   = params
        scopeRef.current    = scope
    })

    useEffect(() => {
        if (!autoApply) return
        if (!didMountRef.current) { didMountRef.current = true; return }

        if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
        applyTimerRef.current = setTimeout(() => {
            if (!imageB64Ref.current || busyRef.current) return
            onApply(imageB64Ref.current, paramsRef.current, scopeRef.current)
        }, 500)

        return () => { if (applyTimerRef.current) clearTimeout(applyTimerRef.current) }
    }, [params, scope]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleApply = useCallback(() => {
        if (!imageB64 || busy) return
        onApply(imageB64, params, scope)
    }, [imageB64, busy, params, scope, onApply])

    const canApply = !!imageB64 && !busy
    const hasAnyChange = SLIDERS.some(d => (params[d.key] as number) !== d.default)

    return (
        <div className="flex flex-col gap-0 rounded-lg border border-gray-700 bg-gray-900 overflow-hidden w-full h-full">
            {/* Header */}
            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex-1">
                    Adjustments
                </span>
                {hasMask && (
                    <div className="flex rounded overflow-hidden border border-gray-700">
                        {(['global', 'segment'] as AdjustmentScope[]).map(s => (
                            <button
                                key={s}
                                onClick={() => onScopeChange(s)}
                                className={`px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                                    scope === s ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                {s === 'global' ? 'Global' : 'Seg'}
                            </button>
                        ))}
                    </div>
                )}
                <button
                    onClick={resetAll}
                    disabled={!hasAnyChange}
                    title="Reset all adjustments"
                    className="text-[10px] text-gray-600 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1"
                >
                    ↺
                </button>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-700/60 mx-3 mb-1" />

            {/* Sliders */}
            <div className="px-3 pb-2 flex flex-col gap-0.5">
                {SLIDERS.map(def => {
                    const value      = params[def.key] as number
                    const isDefault  = value === def.default
                    const displayVal = def.format
                        ? def.format(value)
                        : def.step < 1 ? value.toFixed(2) : String(value)

                    return (
                        <div key={def.key} className="flex items-center gap-1.5 py-0.5">
                            {/* Label — click to reset this param */}
                            <button
                                onClick={() => setParam(def.key, def.default)}
                                disabled={isDefault}
                                title={`${def.label}: click to reset`}
                                className={`text-[10px] w-9 text-right shrink-0 leading-none transition-colors disabled:cursor-default ${
                                    isDefault ? 'text-gray-600' : 'text-indigo-400 hover:text-indigo-300'
                                }`}
                            >
                                {def.short}
                            </button>

                            <input
                                type="range"
                                min={def.min}
                                max={def.max}
                                step={def.step}
                                value={value}
                                onChange={e => setParam(def.key, Number(e.target.value))}
                                className="flex-1 accent-indigo-500 cursor-pointer"
                                style={{ height: '2px' }}
                                aria-label={`${def.label}: ${displayVal}`}
                            />

                            <span className={`text-[10px] w-10 text-right tabular-nums shrink-0 ${
                                isDefault ? 'text-gray-600' : 'text-gray-300'
                            }`}>
                                {displayVal}
                            </span>
                        </div>
                    )
                })}
            </div>

            {/* Footer */}
            <div className="px-3 pb-2.5 flex items-center gap-2">
                {autoApply ? (
                    <span className={`text-[10px] ml-auto transition-opacity ${busy ? 'text-indigo-400 opacity-100' : 'opacity-0'}`}>
                        Applying…
                    </span>
                ) : (
                    <>
                        <button
                            onClick={handleApply}
                            disabled={!canApply}
                            className="flex-1 py-1 rounded text-[10px] font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        >
                            {busy ? 'Applying…' : 'Apply'}
                        </button>
                        <button
                            onClick={resetAll}
                            disabled={!hasAnyChange}
                            className="px-2 py-1 rounded text-[10px] text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            Reset
                        </button>
                    </>
                )}
            </div>

            {!imageB64 && (
                <p className="text-[10px] text-gray-600 text-center pb-2">Load an image to adjust</p>
            )}
        </div>
    )
}
