import { useRef, useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSegmentation, PromptMode } from '../hooks/useSegmentation'
import { useCreativeCanvas, CANVAS_W, CANVAS_H } from '../hooks/useCreativeCanvas'
import { useMaskEditor } from '../hooks/useMaskEditor'
import LibraryPhotoPickerModal from './LibraryPhotoPickerModal'
import CreativeOperationsBar from './CreativeOperationsBar'
import AdjustmentsPanel from './AdjustmentsPanel'
import MaskEditorOverlay from './MaskEditorOverlay'
import type { AdjustmentScope } from '../types/adjustments'
import type { AdjustmentParams } from '../types/adjustments'
import { DEFAULT_ADJUSTMENT_PARAMS } from '../types/adjustments'

const MODE_BUTTONS: { mode: PromptMode; label: string; title: string }[] = [
    { mode: 'box',     label: '□ Box',       title: 'Drag to draw · handles resize · drag inside moves · Delete clears' },
    { mode: 'points',  label: '· Points',    title: 'Click = include · Shift+click = exclude · click point = delete · drag point = move' },
    { mode: 'text',    label: 'Text',        title: 'Describe what to segment — short noun phrases work best (e.g. person · dog · red umbrella)' },
    { mode: 'exemplar',label: '⊡ Exemplar', title: 'Draw a reference box around one instance — SAM 3 finds all similar instances in the photo' },
]

export default function CreativeToolsPanel() {
    const navigate = useNavigate()
    const [pickerOpen,         setPickerOpen]         = useState(false)
    const [exemplarDrawIsNeg,  setExemplarDrawIsNeg]  = useState(false)
    const [adjustScope,        setAdjustScope]        = useState<AdjustmentScope>('global')
    const [adjustPanelOpen,    setAdjustPanelOpen]    = useState(false)
    const [adjustParams,       setAdjustParams]       = useState<Required<AdjustmentParams>>({ ...DEFAULT_ADJUSTMENT_PARAMS })
    const [encodedImageB64,    setEncodedImageB64]    = useState<string | null>(null)
    // resetNonce increments on undo/redo to tell MaskEditorOverlay to reinit its canvas
    const [maskResetNonce, setMaskResetNonce] = useState(0)

    const {
        state,
        checkCapabilities,
        loadImage,
        openImageDialog,
        setPromptMode,
        setText,
        addPoint,
        removePoint,
        movePoint,
        setBox,
        setExemplarBox,
        addExemplarNegBox,
        clearExemplarBoxes,
        clearPrompts,
        setSelectedMaskIdx,
        setTextThreshold,
        setMaskThreshold,
        setFeatherRadius,
        setInvertSelection,
        unionAllMasks,
        predict,
        applyOperation,
        applyAdjustments,
        clearResult,
        saveResult,
        enterEditMask,
        exitEditMask,
        applyMaskEdit,
        undoMask,
        redoMask,
        canUndo,
        canRedo,
        reset,
    } = useSegmentation()

    const {
        canvasRef,
        cursor,
        transform,
        activeMask,
        userZoom,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleMouseLeave,
        handleCanvasClick,
        zoomIn,
        zoomOut,
        fitToView,
    } = useCreativeCanvas({
        state,
        exemplarDrawIsNeg,
        setBox,
        setExemplarBox,
        addExemplarNegBox,
        predict,
        addPoint,
        removePoint,
        movePoint,
        clearPrompts,
        clearExemplarBoxes,
    })

    const { brushSize, setBrushSize, brushMode, toggleBrushMode } = useMaskEditor()

    // -----------------------------------------------------------------------
    // Send to Compose
    // -----------------------------------------------------------------------

    const handleSendToCompose = useCallback(async () => {
        const { resultB64, imagePath } = state
        if (!resultB64 || !imagePath) return
        try {
            // @ts-ignore
            const buf: ArrayBuffer = await window.ipcRenderer.invoke('read-file-buffer', imagePath)
            const blob = new Blob([buf])
            const url  = URL.createObjectURL(blob)
            await new Promise<void>((resolve) => {
                const img = new Image()
                img.onload = () => {
                    const MAX_PX = 2048
                    const scale  = Math.max(img.naturalWidth, img.naturalHeight) > MAX_PX
                        ? MAX_PX / Math.max(img.naturalWidth, img.naturalHeight) : 1
                    const w = Math.round(img.naturalWidth  * scale)
                    const h = Math.round(img.naturalHeight * scale)
                    const canvas = document.createElement('canvas')
                    canvas.width = w; canvas.height = h
                    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
                    URL.revokeObjectURL(url)
                    const sourceImageB64 = canvas.toDataURL('image/png').split(',')[1]
                    const fileName = imagePath.split(/[\\/]/).pop() ?? 'Segment'
                    navigate('/compose', {
                        state: {
                            payload: { sourceImageB64, maskB64: resultB64, suggestedName: fileName },
                        },
                    })
                    resolve()
                }
                img.onerror = () => { URL.revokeObjectURL(url); resolve() }
                img.src = url
            })
        } catch (e) {
            console.warn('[CreativeToolsPanel] handleSendToCompose failed:', e)
        }
    }, [state.resultB64, state.imagePath, navigate])

    // Encode source image for AdjustmentsPanel
    useEffect(() => {
        const path = state.imagePath
        if (!path) { setEncodedImageB64(null); return }
        let cancelled = false
        const run = async () => {
            try {
                // @ts-ignore
                const buf: ArrayBuffer = await window.ipcRenderer.invoke('read-file-buffer', path)
                const blob = new Blob([buf])
                const url  = URL.createObjectURL(blob)
                await new Promise<void>(resolve => {
                    const img = new Image()
                    img.onload = () => {
                        const MAX_PX = 2048
                        const scale  = Math.max(img.naturalWidth, img.naturalHeight) > MAX_PX
                            ? MAX_PX / Math.max(img.naturalWidth, img.naturalHeight) : 1
                        const w = Math.round(img.naturalWidth  * scale)
                        const h = Math.round(img.naturalHeight * scale)
                        const canvas = document.createElement('canvas')
                        canvas.width = w; canvas.height = h
                        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
                        URL.revokeObjectURL(url)
                        if (!cancelled) setEncodedImageB64(canvas.toDataURL('image/png').split(',')[1])
                        resolve()
                    }
                    img.onerror = () => { URL.revokeObjectURL(url); resolve() }
                    img.src = url
                })
            } catch { /* non-critical */ }
        }
        run()
        return () => { cancelled = true }
    }, [state.imagePath])

    // Reset adjustment params when a new image is loaded
    useEffect(() => {
        setAdjustParams({ ...DEFAULT_ADJUSTMENT_PARAMS })
    }, [state.sessionId])

    // Reset exemplar draw toggle when leaving exemplar mode
    useEffect(() => {
        if (state.promptMode !== 'exemplar') setExemplarDrawIsNeg(false)
    }, [state.promptMode])

    // Capabilities check on mount
    useEffect(() => { checkCapabilities() }, [checkCapabilities])

    // -----------------------------------------------------------------------
    // Mask edit keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
    // -----------------------------------------------------------------------

    useEffect(() => {
        if (!state.editingMask) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault()
                setMaskResetNonce(n => n + 1)
                undoMask()
            } else if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault()
                setMaskResetNonce(n => n + 1)
                redoMask()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [state.editingMask, undoMask, redoMask])

    // -----------------------------------------------------------------------
    // Done editing: export overlay canvas and save to state
    // -----------------------------------------------------------------------

    const overlayRef = useRef<{ exportMask: () => string | null }>(null)

    const handleDoneEditing = useCallback(() => {
        const b64 = overlayRef.current?.exportMask()
        if (b64) applyMaskEdit(b64)
        exitEditMask()
    }, [applyMaskEdit, exitEditMask])

    // -----------------------------------------------------------------------
    // Derived
    // -----------------------------------------------------------------------

    const busy = state.isPredicting || state.isApplying || state.isLoadingImage
    const canEdit = state.masks.length > 0 && !state.editingMask

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    return (
        <div className="h-full flex flex-col p-4 gap-3 overflow-hidden min-w-[680px]">

            {/* Header */}
            <div>
                <h2 className="text-xl font-semibold text-white">Creative Tools</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                    Segment and edit photos using SAM 3. Load a photo, choose a prompt mode, then apply an operation.
                </p>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 bg-gray-800/60 rounded-lg px-4 py-2.5 border border-gray-700">
                <button
                    onClick={() => setPickerOpen(true)}
                    disabled={busy || state.editingMask}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    From Library
                </button>
                <button
                    onClick={openImageDialog}
                    disabled={busy || state.editingMask}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                    Load File
                </button>

                {/* Mode toggle */}
                <div className="flex rounded-md overflow-hidden border border-gray-600">
                    {MODE_BUTTONS.map(({ mode, label, title }) => {
                        const isTextMode      = mode === 'text'
                        const textUnavailable = isTextMode && state.capabilities !== null && !state.capabilities.text_prompts
                        return (
                            <button
                                key={mode}
                                onClick={() => !textUnavailable && setPromptMode(mode)}
                                title={title}
                                disabled={textUnavailable || state.editingMask}
                                className={`px-3 py-1.5 text-sm transition-colors ${
                                    textUnavailable
                                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                        : state.promptMode === mode
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>

                {/* Mode hints */}
                {state.promptMode === 'points' && state.imagePath && !state.editingMask && (
                    <span className="text-xs text-gray-400 italic">
                        Click = include &nbsp;·&nbsp; Shift+click = exclude &nbsp;·&nbsp; Click point = delete &nbsp;·&nbsp; Drag point = move
                        {state.box && <span className="text-indigo-400"> &nbsp;·&nbsp; Box preserved — combined mode active</span>}
                    </span>
                )}
                {state.promptMode === 'box' && state.imagePath && state.box && !state.editingMask && (
                    <span className="text-xs text-gray-400 italic">
                        Drag handles to resize &nbsp;·&nbsp; Drag inside to move &nbsp;·&nbsp; Delete key clears
                    </span>
                )}
                {state.promptMode === 'exemplar' && state.imagePath && !state.editingMask && (
                    <span className="text-xs text-gray-400 italic">
                        {!state.exemplarBox
                            ? 'Draw a reference box around one instance'
                            : 'Found instances shown below · draw exclusion boxes to refine · Delete clears all'}
                    </span>
                )}

                {/* Zoom controls */}
                <div className="flex items-center gap-1 ml-auto">
                    <button onClick={zoomOut} title="Zoom out" className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">−</button>
                    <span className="text-xs text-gray-500 tabular-nums w-10 text-center">{Math.round(userZoom * 100)}%</span>
                    <button onClick={zoomIn}    title="Zoom in"  className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">+</button>
                    <button onClick={fitToView} title="Fit"      className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">Fit</button>
                </div>

                {/* Adjust toggle */}
                <button
                    onClick={() => setAdjustPanelOpen(o => !o)}
                    title="Toggle Adjustments panel"
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        adjustPanelOpen
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    Adjust
                </button>

                {/* Clear / Reset */}
                <button
                    onClick={clearPrompts}
                    disabled={!state.sessionId || state.editingMask}
                    className="px-3 py-1.5 rounded-md text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Clear
                </button>
                {state.imagePath && (
                    <button
                        onClick={reset}
                        disabled={state.editingMask}
                        className="px-3 py-1.5 rounded-md text-sm text-gray-400 hover:text-red-400 disabled:opacity-40 transition-colors"
                        title="Unload image and reset"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Text mode — input + confidence sliders */}
            {state.promptMode === 'text' && !state.editingMask && (
                <div className="flex flex-col gap-2 bg-gray-800/60 rounded-lg px-4 py-2.5 border border-gray-700 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={state.text}
                            onChange={e => setText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && state.text.trim() && !busy) predict() }}
                            placeholder="person on the left · red umbrella · dog"
                            disabled={!state.sessionId || busy}
                            className="flex-1 bg-gray-900 border border-gray-600 rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                        />
                        <button
                            onClick={() => predict()}
                            disabled={!state.sessionId || !state.text.trim() || busy}
                            className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        >
                            Segment
                        </button>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-medium w-24 shrink-0">Confidence:</span>
                            <input type="range" min={0.1} max={0.9} step={0.05} value={state.textThreshold} onChange={e => setTextThreshold(Number(e.target.value))} className="w-24 accent-indigo-500" aria-label="Confidence threshold" />
                            <span className="text-xs text-gray-300 w-8 tabular-nums">{state.textThreshold.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-medium w-24 shrink-0">Mask quality:</span>
                            <input type="range" min={0.1} max={0.9} step={0.05} value={state.maskThreshold} onChange={e => setMaskThreshold(Number(e.target.value))} className="w-24 accent-indigo-500" aria-label="Mask quality threshold" />
                            <span className="text-xs text-gray-300 w-8 tabular-nums">{state.maskThreshold.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Exemplar mode — draw-mode toggle */}
            {state.promptMode === 'exemplar' && state.exemplarBox && !state.editingMask && (
                <div className="flex items-center gap-3 bg-gray-800/60 rounded-lg px-4 py-2 border border-gray-700 flex-shrink-0">
                    <span className="text-xs text-gray-400 font-medium">Draw mode:</span>
                    <div className="flex rounded-md overflow-hidden border border-gray-600">
                        <button onClick={() => setExemplarDrawIsNeg(false)} className={`px-3 py-1 text-xs transition-colors ${!exemplarDrawIsNeg ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`} title="Draw a new reference box">⬚ Reference</button>
                        <button onClick={() => setExemplarDrawIsNeg(true)}  className={`px-3 py-1 text-xs transition-colors ${exemplarDrawIsNeg  ? 'bg-red-700 text-white'   : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`} title="Draw exclusion boxes">− Exclude</button>
                    </div>
                    {state.exemplarNegBoxes.length > 0 && (
                        <span className="text-xs text-gray-500">{state.exemplarNegBoxes.length} exclusion{state.exemplarNegBoxes.length !== 1 ? 's' : ''}</span>
                    )}
                </div>
            )}

            {/* Mask editing toolbar */}
            {state.editingMask && (
                <div className="flex items-center gap-3 bg-indigo-950/60 rounded-lg px-4 py-2 border border-indigo-700 flex-shrink-0">
                    <span className="text-xs text-indigo-300 font-medium">Mask Editor</span>
                    <div className="flex rounded-md overflow-hidden border border-gray-600">
                        <button onClick={() => brushMode !== 'erase'  && toggleBrushMode()} className={`px-3 py-1 text-xs transition-colors ${brushMode === 'erase'  ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>⌫ Erase</button>
                        <button onClick={() => brushMode !== 'paint'  && toggleBrushMode()} className={`px-3 py-1 text-xs transition-colors ${brushMode === 'paint'  ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>✏ Paint</button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Size:</span>
                        <input type="range" min={2} max={80} step={1} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-24 accent-indigo-500" />
                        <span className="text-xs text-gray-300 tabular-nums w-6">{brushSize}</span>
                    </div>
                    <button onClick={undoMask} disabled={!canUndo} title="Undo (Ctrl+Z)" className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 transition-colors">↩ Undo</button>
                    <button onClick={() => { setMaskResetNonce(n => n + 1); redoMask() }} disabled={!canRedo} title="Redo (Ctrl+Y)" className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 transition-colors">↪ Redo</button>
                    <button
                        onClick={handleDoneEditing}
                        className="ml-auto px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                    >
                        Done Editing
                    </button>
                </div>
            )}

            {/* Error banner */}
            {state.error && (
                <div className="px-4 py-2 rounded-md bg-red-900/50 border border-red-700 text-red-300 text-sm flex-shrink-0">
                    {state.error}
                </div>
            )}

            {state.capabilities && !state.capabilities.model_ready && (
                <div className="px-4 py-2.5 rounded-md bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm flex-shrink-0">
                    {state.capabilities.transformers_compatible === false
                        ? <span>SAM 3 requires transformers 5.0 dev — run: <code className="bg-black/30 px-1 rounded font-mono text-yellow-200 text-xs select-all">{state.capabilities.install_hint ?? 'pip install git+https://github.com/huggingface/transformers.git'}</code></span>
                        : !state.capabilities.model_file_present
                        ? <span>SAM 3 model not downloaded — get it from <strong>Settings → AI Models</strong>.</span>
                        : <span>SAM 3 failed to load: {state.capabilities.error ?? 'check Settings → AI Models'}</span>
                    }
                </div>
            )}

            {/* Canvas + Result + [Adjust] */}
            <div className="flex-1 flex gap-3 min-h-0">

                {/* Left: canvas */}
                <div className="flex-[3] flex flex-col gap-2 min-h-0 min-w-0">
                    <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-gray-700 bg-gray-900 flex items-center justify-center">
                        <div className="relative" style={{ maxWidth: '100%', maxHeight: '100%' }}>
                            <canvas
                                ref={canvasRef}
                                width={CANVAS_W}
                                height={CANVAS_H}
                                className="block"
                                style={{ maxWidth: '100%', maxHeight: '100%', cursor: state.editingMask ? 'none' : cursor }}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseLeave}
                                onClick={handleCanvasClick}
                            />

                            {/* Mask overlay: passive img OR active editor canvas */}
                            {activeMask && transform && !state.editingMask && (
                                <img
                                    src={`data:image/png;base64,${activeMask.mask_b64}`}
                                    alt=""
                                    className="absolute pointer-events-none"
                                    style={{
                                        top:    `${(transform.offsetY / CANVAS_H) * 100}%`,
                                        left:   `${(transform.offsetX / CANVAS_W) * 100}%`,
                                        width:  `${(transform.renderedW / CANVAS_W) * 100}%`,
                                        height: `${(transform.renderedH / CANVAS_H) * 100}%`,
                                        opacity: 0.45,
                                        filter: 'sepia(1) saturate(10) hue-rotate(220deg)',
                                    }}
                                />
                            )}

                            {state.editingMask && activeMask && transform && (
                                <MaskEditorOverlay
                                    ref={overlayRef}
                                    maskB64={activeMask.mask_b64}
                                    resetNonce={maskResetNonce}
                                    transform={transform}
                                    canvasW={CANVAS_W}
                                    canvasH={CANVAS_H}
                                    brushSize={brushSize}
                                    brushMode={brushMode}
                                    onStrokeEnd={applyMaskEdit}
                                />
                            )}

                            {/* Empty state */}
                            {!state.imagePath && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-2">
                                    <div className="text-4xl">🖼</div>
                                    <div className="text-sm">Load a photo to get started</div>
                                </div>
                            )}

                            {/* Loading overlay */}
                            {busy && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                    <span className="text-white text-sm">
                                        {state.isLoadingImage ? 'Loading image…' :
                                         state.isPredicting   ? 'Segmenting…'    : 'Applying…'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Mask selector pills + Edit Mask button */}
                    {state.masks.length > 0 && (
                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                            <span className="text-xs text-gray-400">
                                {(state.promptMode === 'text' || state.promptMode === 'exemplar')
                                    ? `Found ${state.masks.length} instance${state.masks.length !== 1 ? 's' : ''}:`
                                    : 'Mask:'}
                            </span>
                            {state.masks.map((m, i) => (
                                <button
                                    key={i}
                                    onClick={() => setSelectedMaskIdx(i)}
                                    disabled={state.editingMask}
                                    className={`px-2.5 py-1 rounded-md text-xs transition-colors disabled:opacity-40 ${
                                        state.selectedMaskIdx === i ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                >
                                    {i + 1} ({(m.score * 100).toFixed(0)}%)
                                </button>
                            ))}
                            {(state.promptMode === 'text' || state.promptMode === 'exemplar') && state.masks.length > 1 && !state.editingMask && (
                                <button onClick={unionAllMasks} className="px-2.5 py-1 rounded-md text-xs bg-gray-700 text-indigo-300 hover:bg-gray-600 transition-colors" title="Merge all instances into a single mask">Union All</button>
                            )}
                            {canEdit && (
                                <button onClick={enterEditMask} className="px-2.5 py-1 rounded-md text-xs bg-gray-700 text-yellow-300 hover:bg-yellow-900/40 hover:text-yellow-200 transition-colors" title="Paint or erase the mask pixel-by-pixel">✏ Edit Mask</button>
                            )}
                        </div>
                    )}
                </div>

                {/* Right: result preview */}
                <div className="flex-[2] min-w-[160px] flex flex-col gap-0 rounded-lg border border-gray-700 bg-gray-900 overflow-hidden min-h-0">
                    <div className="px-3 pt-3 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider flex-shrink-0">Result</div>
                    {state.resultB64 ? (
                        <div className="flex-1 flex items-center justify-center p-2 min-h-0" style={{ backgroundImage: 'repeating-conic-gradient(#374151 0% 25%, #1f2937 0% 50%)', backgroundSize: '16px 16px' }}>
                            <img src={`data:image/png;base64,${state.resultB64}`} alt="Result" className="max-w-full max-h-full object-contain" />
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm px-4 text-center">Apply an operation to see the result here</div>
                    )}
                </div>

                {/* Adjustments column — fixed 200px so both canvas and result shrink proportionally */}
                {adjustPanelOpen && (
                    <div className="w-[200px] flex-shrink-0 flex flex-col min-h-0">
                        <AdjustmentsPanel
                            imageB64={encodedImageB64}
                            hasMask={state.masks.length > 0}
                            scope={adjustScope}
                            onScopeChange={setAdjustScope}
                            params={adjustParams}
                            onParamsChange={setAdjustParams}
                            busy={busy}
                            onApply={applyAdjustments}
                            autoApply
                        />
                    </div>
                )}
            </div>

            {/* Operations bar */}
            <CreativeOperationsBar
                hasMasks={state.masks.length > 0}
                busy={busy}
                hasResult={!!state.resultB64}
                resultB64={state.resultB64}
                featherRadius={state.featherRadius}
                invertSelection={state.invertSelection}
                lastOp={state.lastOp}
                onFeatherChange={setFeatherRadius}
                onInvertChange={setInvertSelection}
                onSaveToLibrary={saveResult}
                onSendToCompose={state.resultB64 ? handleSendToCompose : undefined}
                onClearResult={clearResult}
                onApply={applyOperation}
            />

            <LibraryPhotoPickerModal
                open={pickerOpen}
                onSelect={loadImage}
                onClose={() => setPickerOpen(false)}
            />
        </div>
    )
}
