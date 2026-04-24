import { useState, useCallback, useRef, useEffect } from 'react'
import { Operation, LastOp } from '../hooks/useSegmentation'

type SaveStatus = { type: 'idle' } | { type: 'saving' } | { type: 'ok'; path: string } | { type: 'err'; msg: string }
type ClipStatus = { type: 'idle' } | { type: 'ok' } | { type: 'err'; msg: string }

interface Props {
    hasMasks: boolean
    busy: boolean
    hasResult: boolean
    resultB64: string | null
    featherRadius: number
    invertSelection: boolean
    lastOp: LastOp | null
    onFeatherChange: (v: number) => void
    onInvertChange: (v: boolean) => void
    onSaveToLibrary: () => Promise<{ savedPath: string } | { error: string }>
    onSendToCompose?: () => void
    onClearResult: () => void
    onApply: (op: Operation, params?: {
        radius?: number
        featherRadius?: number
        color?: string
        pixelSize?: number
        spotlightBrightness?: number
        tintOpacity?: number
        enhanceOpacity?: number
        enhanceThreshold?: number
    }) => void
}

export default function CreativeOperationsBar({
    hasMasks, busy, hasResult, resultB64,
    featherRadius, invertSelection, lastOp,
    onFeatherChange, onInvertChange, onSaveToLibrary, onSendToCompose,
    onClearResult, onApply,
}: Props) {
    const [blurRadius, setBlurRadius] = useState(15)
    const [fillColor, setFillColor] = useState('#ffffff')
    const [pixelSize, setPixelSize] = useState(12)
    const [spotlightBrightness, setSpotlightBrightness] = useState(0.35)
    const [tintColor, setTintColor] = useState('#ff9900')
    const [tintOpacity, setTintOpacity] = useState(0.5)
    const [enhanceOpacity, setEnhanceOpacity] = useState(1.0)
    const [enhanceThreshold, setEnhanceThreshold] = useState(3)
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [saveStatus, setSaveStatus] = useState<SaveStatus>({ type: 'idle' })
    const [clipStatus, setClipStatus] = useState<ClipStatus>({ type: 'idle' })
    const dropdownRef = useRef<HTMLDivElement>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Close dropdown on outside click
    useEffect(() => {
        if (!dropdownOpen) return
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [dropdownOpen])

    // Clear timers on unmount
    useEffect(() => () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        if (clipTimerRef.current) clearTimeout(clipTimerRef.current)
    }, [])

    const disabled = !hasMasks || busy

    // Toggle: clicking the active operation clears the result; clicking a new one applies it
    const apply = useCallback(
        (op: Operation, extra?: {
            radius?: number
            color?: string
            pixelSize?: number
            spotlightBrightness?: number
            tintOpacity?: number
            enhanceOpacity?: number
            enhanceThreshold?: number
        }) => {
            if (lastOp?.operation === op) {
                onClearResult()
            } else {
                onApply(op, { featherRadius, ...extra })
            }
        },
        [onApply, onClearResult, featherRadius, lastOp],
    )

    // Returns true when the given operation is the currently active one
    const isActive = (op: Operation) => lastOp?.operation === op

    const handleSaveToLibrary = useCallback(async () => {
        setSaveStatus({ type: 'saving' })
        const result = await onSaveToLibrary()
        if ('savedPath' in result) {
            // Show only the file name to keep the label short
            const fileName = result.savedPath.split(/[\\/]/).pop() ?? result.savedPath
            setSaveStatus({ type: 'ok', path: fileName })
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveTimerRef.current = setTimeout(() => setSaveStatus({ type: 'idle' }), 3000)
        } else {
            setSaveStatus({ type: 'err', msg: result.error })
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveTimerRef.current = setTimeout(() => setSaveStatus({ type: 'idle' }), 3000)
        }
    }, [onSaveToLibrary])

    const handleCopyToClipboard = useCallback(async () => {
        if (!resultB64) return
        setDropdownOpen(false)
        try {
            const blob = await fetch(`data:image/png;base64,${resultB64}`).then(r => r.blob())
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            setClipStatus({ type: 'ok' })
        } catch (e: any) {
            setClipStatus({ type: 'err', msg: e.message ?? 'Copy failed' })
        }
        if (clipTimerRef.current) clearTimeout(clipTimerRef.current)
        clipTimerRef.current = setTimeout(() => setClipStatus({ type: 'idle' }), 3000)
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
                    title={isActive('background-remove') ? 'Click to clear result' : undefined}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ${isActive('background-remove') ? 'bg-indigo-700 hover:bg-indigo-600 ring-1 ring-indigo-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    Remove BG
                </button>

                <button onClick={() => apply('isolate')} disabled={disabled}
                    title={isActive('isolate') ? 'Click to clear result' : undefined}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ${isActive('isolate') ? 'bg-indigo-700 hover:bg-indigo-600 ring-1 ring-indigo-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    Isolate
                </button>

                <button onClick={() => apply('desaturate-bg')} disabled={disabled}
                    title={isActive('desaturate-bg') ? 'Click to clear result' : 'Keep subject in color, convert background to grayscale'}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ${isActive('desaturate-bg') ? 'bg-indigo-700 hover:bg-indigo-600 ring-1 ring-indigo-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    B&amp;W BG
                </button>

                {/* Blur BG */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('blur') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => apply('blur', { radius: blurRadius })} disabled={disabled}
                        title={isActive('blur') ? 'Click to clear result' : 'Blur the background, keep subject sharp'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('blur') ? 'text-indigo-200' : 'text-white'}`}>
                        Blur BG
                    </button>
                    <input type="range" min={3} max={50} step={1} value={blurRadius}
                        onChange={e => setBlurRadius(Number(e.target.value))}
                        className="w-16 accent-indigo-500" aria-label="Blur radius" />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{blurRadius}</span>
                </div>

                {/* Pixelate BG */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('pixelate-bg') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => apply('pixelate-bg', { pixelSize })} disabled={disabled}
                        title={isActive('pixelate-bg') ? 'Click to clear result' : 'Pixelate the background'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('pixelate-bg') ? 'text-indigo-200' : 'text-white'}`}>
                        Pixelate BG
                    </button>
                    <input type="range" min={4} max={40} step={2} value={pixelSize}
                        onChange={e => setPixelSize(Number(e.target.value))}
                        className="w-16 accent-indigo-500" aria-label="Pixel size" />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{pixelSize}</span>
                </div>

                {/* Spotlight */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('spotlight') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => apply('spotlight', { spotlightBrightness })} disabled={disabled}
                        title={isActive('spotlight') ? 'Click to clear result' : 'Darken background, keep subject bright'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('spotlight') ? 'text-indigo-200' : 'text-white'}`}>
                        Spotlight
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={spotlightBrightness}
                        onChange={e => setSpotlightBrightness(Number(e.target.value))}
                        className="w-16 accent-indigo-500" aria-label="Background brightness" />
                    <span className="text-xs text-gray-300 w-8 tabular-nums">{spotlightBrightness.toFixed(2)}</span>
                </div>

                {/* Fill BG */}
                <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${isActive('fill-bg') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Fill color" />
                    <button onClick={() => apply('fill-bg', { color: fillColor })} disabled={disabled}
                        title={isActive('fill-bg') ? 'Click to clear result' : 'Replace background with solid color'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed px-1 ${isActive('fill-bg') ? 'text-indigo-200' : 'text-white'}`}>
                        Fill BG
                    </button>
                </div>

                {/* Color Tint */}
                <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${isActive('color-tint') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <input type="color" value={tintColor} onChange={e => setTintColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Tint color" />
                    <button onClick={() => apply('color-tint', { color: tintColor, tintOpacity })} disabled={disabled}
                        title={isActive('color-tint') ? 'Click to clear result' : 'Apply a semi-transparent color wash over the background'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed px-1 ${isActive('color-tint') ? 'text-indigo-200' : 'text-white'}`}>
                        Color Tint
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={tintOpacity}
                        onChange={e => setTintOpacity(Number(e.target.value))}
                        className="w-14 accent-indigo-500" aria-label="Tint opacity" />
                    <span className="text-xs text-gray-300 w-8 tabular-nums">{(tintOpacity * 100).toFixed(0)}%</span>
                </div>

                {/* Sharpen */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('enhance') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => apply('enhance', { enhanceOpacity, enhanceThreshold })} disabled={disabled}
                        title={isActive('enhance') ? 'Click to clear result' : 'Sharpen the selected subject'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('enhance') ? 'text-indigo-200' : 'text-white'}`}>
                        Sharpen
                    </button>
                    <span className="text-xs text-gray-400 shrink-0">Opacity</span>
                    <input type="range" min={0} max={1} step={0.05} value={enhanceOpacity}
                        onChange={e => setEnhanceOpacity(Number(e.target.value))}
                        className="w-14 accent-indigo-500" aria-label="Sharpen opacity" />
                    <span className="text-xs text-gray-300 w-6 tabular-nums">{Math.round(enhanceOpacity * 100)}%</span>
                    <span className="text-xs text-gray-400 shrink-0">Detail</span>
                    <input type="range" min={0} max={10} step={1} value={enhanceThreshold}
                        onChange={e => setEnhanceThreshold(Number(e.target.value))}
                        className="w-14 accent-indigo-500" aria-label="Sharpen detail threshold" />
                    <span className="text-xs text-gray-300 w-4 tabular-nums">{enhanceThreshold}</span>
                </div>

                {/* Split-button: Save to Library + Copy to Clipboard */}
                <div className="ml-auto flex items-center gap-2">

                    {/* Inline status feedback */}
                    {saveStatus.type === 'ok' && (
                        <span className="text-xs text-green-400 truncate max-w-[180px]" title={saveStatus.path}>
                            Saved: {saveStatus.path}
                        </span>
                    )}
                    {saveStatus.type === 'err' && (
                        <span className="text-xs text-red-400 truncate max-w-[180px]" title={saveStatus.msg}>
                            Error: {saveStatus.msg}
                        </span>
                    )}
                    {clipStatus.type === 'ok' && saveStatus.type === 'idle' && (
                        <span className="text-xs text-green-400">Copied!</span>
                    )}
                    {clipStatus.type === 'err' && saveStatus.type === 'idle' && (
                        <span className="text-xs text-red-400 truncate max-w-[180px]" title={clipStatus.msg}>
                            {clipStatus.msg}
                        </span>
                    )}

                    {/* Split-button container */}
                    <div ref={dropdownRef} className="relative flex">
                        {/* Primary: Save to Library */}
                        <button
                            onClick={handleSaveToLibrary}
                            disabled={!hasResult || saveStatus.type === 'saving'}
                            className="px-3 py-1.5 rounded-l-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors border-r border-indigo-400"
                        >
                            {saveStatus.type === 'saving' ? 'Saving…' : '↓ Save to Library'}
                        </button>

                        {/* Chevron toggle */}
                        <button
                            onClick={() => setDropdownOpen(o => !o)}
                            disabled={!hasResult}
                            aria-label="More save options"
                            className="px-2 py-1.5 rounded-r-md text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        >
                            ▾
                        </button>

                        {/* Dropdown */}
                        {dropdownOpen && (
                            <div className="absolute right-0 bottom-full mb-1 w-44 rounded-md shadow-lg bg-gray-700 border border-gray-600 z-10">
                                <button
                                    onClick={handleCopyToClipboard}
                                    className="w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-600 rounded-md"
                                >
                                    Copy to Clipboard
                                </button>
                                {onSendToCompose && (
                                    <button
                                        onClick={() => { setDropdownOpen(false); onSendToCompose() }}
                                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-600 rounded-md"
                                        title="Push this segment as a new layer into the Compositing Workspace"
                                    >
                                        Send to Compose ↗
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
