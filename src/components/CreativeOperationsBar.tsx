import { useState, useCallback } from 'react'
import { Operation } from '../hooks/useSegmentation'

interface Props {
    hasMasks: boolean
    busy: boolean
    hasResult: boolean
    resultB64: string | null
    onApply: (op: Operation, params?: { radius?: number; featherRadius?: number; color?: string }) => void
}

export default function CreativeOperationsBar({ hasMasks, busy, hasResult, resultB64, onApply }: Props) {
    const [blurRadius, setBlurRadius] = useState(15)
    const [featherRadius, setFeatherRadius] = useState(0)
    const [fillColor, setFillColor] = useState('#ffffff')

    const disabled = !hasMasks || busy

    const apply = useCallback(
        (op: Operation, extra?: { radius?: number; color?: string }) =>
            onApply(op, { featherRadius, ...extra }),
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

            {/* Feather slider — applies to all operations */}
            <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-medium w-16 shrink-0">Feather:</span>
                <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={featherRadius}
                    onChange={e => setFeatherRadius(Number(e.target.value))}
                    className="w-28 accent-indigo-500"
                    aria-label="Feather radius"
                />
                <span className="text-xs text-gray-300 w-5 tabular-nums">{featherRadius}</span>
                <span className="text-xs text-gray-500 ml-1">px — softens all mask edges</span>
            </div>

            {/* Operation buttons */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400 font-medium mr-1">Operations:</span>

                <button
                    onClick={() => apply('background-remove')}
                    disabled={disabled}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    Remove BG
                </button>

                <button
                    onClick={() => apply('isolate')}
                    disabled={disabled}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    Isolate
                </button>

                <button
                    onClick={() => apply('desaturate-bg')}
                    disabled={disabled}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    title="Keep subject in color, convert background to grayscale"
                >
                    B&amp;W BG
                </button>

                {/* Fill BG: color swatch + button together */}
                <div className="flex items-center gap-1 bg-gray-700 rounded-md px-2 py-1">
                    <input
                        type="color"
                        value={fillColor}
                        onChange={e => setFillColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Background fill color"
                    />
                    <button
                        onClick={() => apply('fill-bg', { color: fillColor })}
                        disabled={disabled}
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed px-1"
                        title="Replace background with the selected color"
                    >
                        Fill BG
                    </button>
                </div>

                {/* Blur BG with radius slider */}
                <div className="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-1">
                    <button
                        onClick={() => apply('blur', { radius: blurRadius })}
                        disabled={disabled}
                        className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Blur the background, keep subject sharp"
                    >
                        Blur BG
                    </button>
                    <input
                        type="range"
                        min={3}
                        max={50}
                        step={1}
                        value={blurRadius}
                        onChange={e => setBlurRadius(Number(e.target.value))}
                        className="w-20 accent-indigo-500"
                        aria-label="Blur radius"
                    />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{blurRadius}</span>
                </div>

                <button
                    onClick={() => apply('enhance')}
                    disabled={disabled}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    title="Sharpen the selected subject"
                >
                    Sharpen
                </button>

                <button
                    onClick={downloadBlob}
                    disabled={!hasResult}
                    className="ml-auto px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    ↓ Save
                </button>
            </div>
        </div>
    )
}
