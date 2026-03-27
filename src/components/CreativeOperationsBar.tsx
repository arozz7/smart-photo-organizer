import { useState, useCallback } from 'react'
import { Operation } from '../hooks/useSegmentation'

interface Props {
    hasMasks: boolean
    busy: boolean
    hasResult: boolean
    resultB64: string | null
    featherRadius: number
    invertSelection: boolean
    onFeatherChange: (v: number) => void
    onInvertChange: (v: boolean) => void
    onApply: (op: Operation, params?: {
        radius?: number
        featherRadius?: number
        color?: string
        pixelSize?: number
        spotlightBrightness?: number
        tintOpacity?: number
    }) => void
}

export default function CreativeOperationsBar({
    hasMasks, busy, hasResult, resultB64,
    featherRadius, invertSelection,
    onFeatherChange, onInvertChange, onApply,
}: Props) {
    const [blurRadius, setBlurRadius] = useState(15)
    const [fillColor, setFillColor] = useState('#ffffff')
    const [pixelSize, setPixelSize] = useState(12)
    const [spotlightBrightness, setSpotlightBrightness] = useState(0.35)
    const [tintColor, setTintColor] = useState('#ff9900')
    const [tintOpacity, setTintOpacity] = useState(0.5)

    const disabled = !hasMasks || busy

    const apply = useCallback(
        (op: Operation, extra?: {
            radius?: number
            color?: string
            pixelSize?: number
            spotlightBrightness?: number
            tintOpacity?: number
        }) => onApply(op, { featherRadius, ...extra }),
        [onApply, featherRadius],
    )

    const downloadBlob = useCallback(() => {
        if (!resultB64) return
        const link = document.createElement('a')
        link.href = `data:image/png;base64,${resultB64}`
        link.download = `creative-result-${Date.now()}.png`
        link.click()
    }, [resultB64])

    return (
        <div className="flex flex-col gap-2 bg-gray-800/60 rounded-lg px-4 py-2.5 border border-gray-700 flex-shrink-0">

            {/* Global modifiers row */}
            <div className="flex items-center gap-4 flex-wrap">
                {/* Feather slider */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 font-medium w-14 shrink-0">Feather:</span>
                    <input
                        type="range" min={0} max={30} step={1}
                        value={featherRadius}
                        onChange={e => onFeatherChange(Number(e.target.value))}
                        className="w-24 accent-indigo-500"
                        aria-label="Feather radius"
                    />
                    <span className="text-xs text-gray-300 w-5 tabular-nums">{featherRadius}</span>
                    <span className="text-xs text-gray-500">px</span>
                </div>

                {/* Invert Selection toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={invertSelection}
                        onChange={e => onInvertChange(e.target.checked)}
                        className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer"
                        aria-label="Invert selection"
                    />
                    <span className={`text-xs font-medium ${invertSelection ? 'text-indigo-300' : 'text-gray-400'}`}>
                        Invert Selection
                    </span>
                    {invertSelection && (
                        <span className="text-xs text-indigo-400 italic">(ops apply to subject)</span>
                    )}
                </label>
            </div>

            {/* Operation buttons */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400 font-medium mr-1">Operations:</span>

                <button onClick={() => apply('background-remove')} disabled={disabled}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                    Remove BG
                </button>

                <button onClick={() => apply('isolate')} disabled={disabled}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                    Isolate
                </button>

                <button onClick={() => apply('desaturate-bg')} disabled={disabled}
                    title="Keep subject in color, convert background to grayscale"
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                    B&amp;W BG
                </button>

                {/* Blur BG */}
                <div className="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-1">
                    <button onClick={() => apply('blur', { radius: blurRadius })} disabled={disabled}
                        title="Blur the background, keep subject sharp"
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed">
                        Blur BG
                    </button>
                    <input type="range" min={3} max={50} step={1} value={blurRadius}
                        onChange={e => setBlurRadius(Number(e.target.value))}
                        className="w-16 accent-indigo-500" aria-label="Blur radius" />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{blurRadius}</span>
                </div>

                {/* Pixelate BG */}
                <div className="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-1">
                    <button onClick={() => apply('pixelate-bg', { pixelSize })} disabled={disabled}
                        title="Pixelate the background"
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed">
                        Pixelate BG
                    </button>
                    <input type="range" min={4} max={40} step={2} value={pixelSize}
                        onChange={e => setPixelSize(Number(e.target.value))}
                        className="w-16 accent-indigo-500" aria-label="Pixel size" />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{pixelSize}</span>
                </div>

                {/* Spotlight */}
                <div className="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-1">
                    <button onClick={() => apply('spotlight', { spotlightBrightness })} disabled={disabled}
                        title="Darken background, keep subject bright"
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed">
                        Spotlight
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={spotlightBrightness}
                        onChange={e => setSpotlightBrightness(Number(e.target.value))}
                        className="w-16 accent-indigo-500" aria-label="Background brightness" />
                    <span className="text-xs text-gray-300 w-8 tabular-nums">{spotlightBrightness.toFixed(2)}</span>
                </div>

                {/* Fill BG */}
                <div className="flex items-center gap-1 bg-gray-700 rounded-md px-2 py-1">
                    <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Fill color" />
                    <button onClick={() => apply('fill-bg', { color: fillColor })} disabled={disabled}
                        title="Replace background with solid color"
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed px-1">
                        Fill BG
                    </button>
                </div>

                {/* Color Tint */}
                <div className="flex items-center gap-1 bg-gray-700 rounded-md px-2 py-1">
                    <input type="color" value={tintColor} onChange={e => setTintColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Tint color" />
                    <button onClick={() => apply('color-tint', { color: tintColor, tintOpacity })} disabled={disabled}
                        title="Apply a semi-transparent color wash over the background"
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed px-1">
                        Color Tint
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={tintOpacity}
                        onChange={e => setTintOpacity(Number(e.target.value))}
                        className="w-14 accent-indigo-500" aria-label="Tint opacity" />
                    <span className="text-xs text-gray-300 w-8 tabular-nums">{(tintOpacity * 100).toFixed(0)}%</span>
                </div>

                <button onClick={() => apply('enhance')} disabled={disabled}
                    title="Sharpen the selected subject"
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                    Sharpen
                </button>

                <button onClick={downloadBlob} disabled={!hasResult}
                    className="ml-auto px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                    ↓ Save
                </button>
            </div>
        </div>
    )
}
