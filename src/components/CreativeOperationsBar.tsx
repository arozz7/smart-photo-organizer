import { useState, useCallback } from 'react'
import { Operation } from '../hooks/useSegmentation'

interface Props {
    hasMasks: boolean
    busy: boolean
    hasResult: boolean
    resultB64: string | null
    onApply: (op: Operation, params?: { radius: number }) => void
}

export default function CreativeOperationsBar({ hasMasks, busy, hasResult, resultB64, onApply }: Props) {
    const [blurRadius, setBlurRadius] = useState(15)

    const disabled = !hasMasks || busy

    const downloadBlob = useCallback(() => {
        if (!resultB64) return
        const link = document.createElement('a')
        link.href = `data:image/png;base64,${resultB64}`
        link.download = `creative-result-${Date.now()}.png`
        link.click()
    }, [resultB64])

    return (
        <div className="flex flex-wrap items-center gap-2 bg-gray-800/60 rounded-lg px-4 py-2.5 border border-gray-700 flex-shrink-0">
            <span className="text-xs text-gray-400 font-medium mr-1">Operations:</span>

            <button
                onClick={() => onApply('background-remove')}
                disabled={disabled}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
                Remove BG
            </button>

            <button
                onClick={() => onApply('isolate')}
                disabled={disabled}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
                Isolate
            </button>

            <div className="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-1">
                <button
                    onClick={() => onApply('blur', { radius: blurRadius })}
                    disabled={disabled}
                    className="text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Blur
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
                onClick={() => onApply('enhance')}
                disabled={disabled}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
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
    )
}
