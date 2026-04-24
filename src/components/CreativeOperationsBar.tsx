import { useState, useCallback, useRef, useEffect } from 'react'
import type { Operation, OpExtra } from '../hooks/useSegmentation'

type SaveStatus = { type: 'idle' } | { type: 'saving' } | { type: 'ok'; path: string } | { type: 'err'; msg: string }
type ClipStatus = { type: 'idle' } | { type: 'ok' } | { type: 'err'; msg: string }

interface Props {
    hasMasks: boolean
    busy: boolean
    hasResult: boolean
    resultB64: string | null
    featherRadius: number
    invertSelection: boolean
    activeOps: Operation[]
    onFeatherChange: (v: number) => void
    onInvertChange: (v: boolean) => void
    onSaveToLibrary: () => Promise<{ savedPath: string } | { error: string }>
    onSendToCompose?: () => void
    onApplyOp: (op: Operation, extra?: OpExtra) => void
    onDeactivateOp: (op: Operation) => void
}

export default function CreativeOperationsBar({
    hasMasks, busy, hasResult, resultB64,
    featherRadius, invertSelection, activeOps,
    onFeatherChange, onInvertChange, onSaveToLibrary, onSendToCompose,
    onApplyOp, onDeactivateOp,
}: Props) {
    const [blurRadius,           setBlurRadius]           = useState(15)
    const [fillColor,            setFillColor]            = useState('#ffffff')
    const [pixelSize,            setPixelSize]            = useState(12)
    const [spotlightBrightness,  setSpotlightBrightness]  = useState(0.35)
    const [tintColor,            setTintColor]            = useState('#ff9900')
    const [tintOpacity,          setTintOpacity]          = useState(0.5)
    const [enhanceOpacity,       setEnhanceOpacity]       = useState(1.0)
    const [enhanceThreshold,     setEnhanceThreshold]     = useState(3)
    const [dropdownOpen,         setDropdownOpen]         = useState(false)
    const [saveStatus,           setSaveStatus]           = useState<SaveStatus>({ type: 'idle' })
    const [clipStatus,           setClipStatus]           = useState<ClipStatus>({ type: 'idle' })
    const dropdownRef   = useRef<HTMLDivElement>(null)
    const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clipTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Per-compound-button debounce timers for slider auto-reapply.
    const blurDebRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pixelDebRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
    const spotDebRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
    const tintDebRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
    const enhDebRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Stable ref to onApplyOp so debounce closures never go stale.
    const onApplyOpRef = useRef(onApplyOp)
    useEffect(() => { onApplyOpRef.current = onApplyOp })

    // Close dropdown on outside click.
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

    // Clear all timers on unmount.
    useEffect(() => () => {
        [saveTimerRef, clipTimerRef, blurDebRef, pixelDebRef, spotDebRef, tintDebRef, enhDebRef]
            .forEach(r => { if (r.current) clearTimeout(r.current) })
    }, [])

    const disabled = !hasMasks || busy
    const isActive = (op: Operation) => activeOps.includes(op)

    // Toggle an op on/off; for compound buttons also carries the current param state.
    const toggle = useCallback((op: Operation, extra?: OpExtra) => {
        if (isActive(op)) {
            onDeactivateOp(op)
        } else {
            onApplyOp(op, extra)
        }
    }, [isActive, onApplyOp, onDeactivateOp]) // eslint-disable-line react-hooks/exhaustive-deps

    // Debounced slider re-apply for a compound button that is already active.
    function sliderChange(
        op: Operation,
        extra: OpExtra,
        debRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    ) {
        if (!isActive(op)) return
        if (debRef.current) clearTimeout(debRef.current)
        debRef.current = setTimeout(() => onApplyOpRef.current(op, extra), 400)
    }

    const handleSaveToLibrary = useCallback(async () => {
        setSaveStatus({ type: 'saving' })
        const result = await onSaveToLibrary()
        if ('savedPath' in result) {
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

                {/* Simple toggle buttons */}
                {(['background-remove', 'isolate', 'desaturate-bg'] as Operation[]).map(op => (
                    <button key={op} onClick={() => toggle(op)} disabled={disabled}
                        title={isActive(op) ? 'Click to deactivate' : undefined}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ${
                            isActive(op) ? 'bg-indigo-700 hover:bg-indigo-600 ring-1 ring-indigo-400' : 'bg-gray-700 hover:bg-gray-600'
                        }`}>
                        {op === 'background-remove' ? 'Remove BG' : op === 'isolate' ? 'Isolate' : 'B&W BG'}
                    </button>
                ))}

                {/* Blur BG */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('blur') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => toggle('blur', { radius: blurRadius })} disabled={disabled}
                        title={isActive('blur') ? 'Click to deactivate' : 'Blur the background'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('blur') ? 'text-indigo-200' : 'text-white'}`}>
                        Blur BG
                    </button>
                    <input type="range" min={3} max={50} step={1} value={blurRadius}
                        onChange={e => {
                            const v = Number(e.target.value)
                            setBlurRadius(v)
                            sliderChange('blur', { radius: v }, blurDebRef)
                        }}
                        className="w-16 accent-indigo-500" aria-label="Blur radius" />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{blurRadius}</span>
                </div>

                {/* Pixelate BG */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('pixelate-bg') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => toggle('pixelate-bg', { pixelSize })} disabled={disabled}
                        title={isActive('pixelate-bg') ? 'Click to deactivate' : 'Pixelate the background'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('pixelate-bg') ? 'text-indigo-200' : 'text-white'}`}>
                        Pixelate BG
                    </button>
                    <input type="range" min={4} max={40} step={2} value={pixelSize}
                        onChange={e => {
                            const v = Number(e.target.value)
                            setPixelSize(v)
                            sliderChange('pixelate-bg', { pixelSize: v }, pixelDebRef)
                        }}
                        className="w-16 accent-indigo-500" aria-label="Pixel size" />
                    <span className="text-xs text-gray-300 w-5 text-right tabular-nums">{pixelSize}</span>
                </div>

                {/* Spotlight */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('spotlight') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => toggle('spotlight', { spotlightBrightness })} disabled={disabled}
                        title={isActive('spotlight') ? 'Click to deactivate' : 'Darken background, keep subject bright'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('spotlight') ? 'text-indigo-200' : 'text-white'}`}>
                        Spotlight
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={spotlightBrightness}
                        onChange={e => {
                            const v = Number(e.target.value)
                            setSpotlightBrightness(v)
                            sliderChange('spotlight', { spotlightBrightness: v }, spotDebRef)
                        }}
                        className="w-16 accent-indigo-500" aria-label="Background brightness" />
                    <span className="text-xs text-gray-300 w-8 tabular-nums">{spotlightBrightness.toFixed(2)}</span>
                </div>

                {/* Fill BG */}
                <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${isActive('fill-bg') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <input type="color" value={fillColor}
                        onChange={e => {
                            setFillColor(e.target.value)
                            sliderChange('fill-bg', { color: e.target.value }, blurDebRef)
                        }}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Fill color" />
                    <button onClick={() => toggle('fill-bg', { color: fillColor })} disabled={disabled}
                        title={isActive('fill-bg') ? 'Click to deactivate' : 'Replace background with solid color'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed px-1 ${isActive('fill-bg') ? 'text-indigo-200' : 'text-white'}`}>
                        Fill BG
                    </button>
                </div>

                {/* Color Tint */}
                <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${isActive('color-tint') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <input type="color" value={tintColor}
                        onChange={e => {
                            setTintColor(e.target.value)
                            sliderChange('color-tint', { color: e.target.value, tintOpacity }, tintDebRef)
                        }}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Tint color" />
                    <button onClick={() => toggle('color-tint', { color: tintColor, tintOpacity })} disabled={disabled}
                        title={isActive('color-tint') ? 'Click to deactivate' : 'Apply a semi-transparent color wash'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed px-1 ${isActive('color-tint') ? 'text-indigo-200' : 'text-white'}`}>
                        Color Tint
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={tintOpacity}
                        onChange={e => {
                            const v = Number(e.target.value)
                            setTintOpacity(v)
                            sliderChange('color-tint', { color: tintColor, tintOpacity: v }, tintDebRef)
                        }}
                        className="w-14 accent-indigo-500" aria-label="Tint opacity" />
                    <span className="text-xs text-gray-300 w-8 tabular-nums">{(tintOpacity * 100).toFixed(0)}%</span>
                </div>

                {/* Sharpen — stackable with any bg op */}
                <div className={`flex items-center gap-2 rounded-md px-3 py-1 ${isActive('enhance') ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'bg-gray-700'}`}>
                    <button onClick={() => toggle('enhance', { enhanceOpacity, enhanceThreshold })} disabled={disabled}
                        title={isActive('enhance') ? 'Click to deactivate' : 'Sharpen the selected subject'}
                        className={`text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${isActive('enhance') ? 'text-indigo-200' : 'text-white'}`}>
                        Sharpen
                    </button>
                    <span className="text-xs text-gray-400 shrink-0">Opacity</span>
                    <input type="range" min={0} max={1} step={0.05} value={enhanceOpacity}
                        onChange={e => {
                            const v = Number(e.target.value)
                            setEnhanceOpacity(v)
                            sliderChange('enhance', { enhanceOpacity: v, enhanceThreshold }, enhDebRef)
                        }}
                        className="w-14 accent-indigo-500" aria-label="Sharpen opacity" />
                    <span className="text-xs text-gray-300 w-6 tabular-nums">{Math.round(enhanceOpacity * 100)}%</span>
                    <span className="text-xs text-gray-400 shrink-0">Detail</span>
                    <input type="range" min={0} max={10} step={1} value={enhanceThreshold}
                        onChange={e => {
                            const v = Number(e.target.value)
                            setEnhanceThreshold(v)
                            sliderChange('enhance', { enhanceOpacity, enhanceThreshold: v }, enhDebRef)
                        }}
                        className="w-14 accent-indigo-500" aria-label="Sharpen detail threshold" />
                    <span className="text-xs text-gray-300 w-4 tabular-nums">{enhanceThreshold}</span>
                </div>

                {/* Split-button: Save to Library + Copy to Clipboard */}
                <div className="ml-auto flex items-center gap-2">
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

                    <div ref={dropdownRef} className="relative flex">
                        <button
                            onClick={handleSaveToLibrary}
                            disabled={!hasResult || saveStatus.type === 'saving'}
                            className="px-3 py-1.5 rounded-l-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors border-r border-indigo-400"
                        >
                            {saveStatus.type === 'saving' ? 'Saving…' : '↓ Save to Library'}
                        </button>
                        <button
                            onClick={() => setDropdownOpen(o => !o)}
                            disabled={!hasResult}
                            aria-label="More save options"
                            className="px-2 py-1.5 rounded-r-md text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        >
                            ▾
                        </button>
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
