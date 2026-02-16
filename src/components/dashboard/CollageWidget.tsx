import { useState, useCallback, useRef, useEffect } from 'react'
import { computeLayout, photoCountForMode } from './collageLayouts'
import type { LayoutMode, CollageRect } from './collageLayouts'

interface MemoryPhoto {
    id: number
    file_path: string
    preview_cache_path: string | null
    year: number
    width: number
    height: number
}

interface CollageWidgetProps {
    photos: MemoryPhoto[]
}

const CANVAS_W = 1200
const CANVAS_H = 800
const CORNER_RADIUS = 12

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
}

async function loadBase64Image(filePath: string): Promise<HTMLImageElement> {
    // @ts-ignore
    const res = await window.ipcRenderer.invoke('collage:readPhotoBase64', filePath)
    if (!res.success) throw new Error(res.error)
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = res.dataUrl
    })
}

function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, rect: CollageRect) {
    const { x, y, w, h } = rect
    const imgRatio = img.width / img.height
    const rectRatio = w / h

    let sx = 0, sy = 0, sw = img.width, sh = img.height
    if (imgRatio > rectRatio) {
        sw = img.height * rectRatio
        sx = (img.width - sw) / 2
    } else {
        sh = img.width / rectRatio
        sy = (img.height - sh) / 2
    }

    ctx.save()
    drawRoundedRect(ctx, x, y, w, h, CORNER_RADIUS)
    ctx.clip()
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
    ctx.restore()
}

export default function CollageWidget({ photos }: CollageWidgetProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [mode, setMode] = useState<LayoutMode>('feature')
    const [loading, setLoading] = useState(false)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [collagePhotos, setCollagePhotos] = useState<MemoryPhoto[]>([])

    const generateCollage = useCallback(async (layoutMode: LayoutMode, sourcePhotos?: MemoryPhoto[]) => {
        const pool = sourcePhotos || collagePhotos
        if (pool.length === 0) return

        setLoading(true)
        try {
            const count = photoCountForMode(layoutMode)
            const selected = pool.slice(0, count)
            const rects = computeLayout(layoutMode, selected.length, CANVAS_W, CANVAS_H)

            // Load all photos as base64 in parallel
            const images = await Promise.all(
                selected.map(p => {
                    const path = p.preview_cache_path || p.file_path
                    return loadBase64Image(path)
                })
            )

            // Draw on canvas
            const canvas = canvasRef.current
            if (!canvas) return
            canvas.width = CANVAS_W
            canvas.height = CANVAS_H
            const ctx = canvas.getContext('2d')
            if (!ctx) return

            // Background
            ctx.fillStyle = '#1f2937'
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

            // Draw each photo
            for (let i = 0; i < rects.length; i++) {
                const rect = rects[i]
                const img = images[rect.photoIndex]
                if (img) drawImageCover(ctx, img, rect)
            }

            setPreviewUrl(canvas.toDataURL('image/png'))
        } catch (e) {
            console.error('[CollageWidget] Generation failed:', e)
        } finally {
            setLoading(false)
        }
    }, [collagePhotos])

    const fetchAndGenerate = useCallback(async (layoutMode: LayoutMode) => {
        setLoading(true)
        try {
            const count = photoCountForMode(layoutMode)
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('dashboard:getCollagePhotos', count)
            if (res.success && res.photos.length > 0) {
                setCollagePhotos(res.photos)
                await generateCollage(layoutMode, res.photos)
            }
        } catch (e) {
            console.error('[CollageWidget] Fetch failed:', e)
        } finally {
            setLoading(false)
        }
    }, [generateCollage])

    // Generate on mount if we have initial photos
    useEffect(() => {
        if (photos.length > 0) {
            setCollagePhotos(photos)
            generateCollage(mode, photos)
        } else {
            fetchAndGenerate(mode)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleModeChange = useCallback((newMode: LayoutMode) => {
        setMode(newMode)
        generateCollage(newMode)
    }, [generateCollage])

    const handleRegenerate = useCallback(() => {
        fetchAndGenerate(mode)
    }, [fetchAndGenerate, mode])

    const handleExport = useCallback(async () => {
        if (!previewUrl) return
        const now = new Date()
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        // @ts-ignore
        await window.ipcRenderer.invoke('collage:exportCollage', {
            dataUrl: previewUrl,
            defaultName: `collage-${dateStr}.png`,
        })
    }, [previewUrl])

    if (photos.length === 0 && collagePhotos.length === 0 && !loading) {
        return (
            <div className="bg-gray-800/60 backdrop-blur rounded-2xl p-6 border border-gray-700/50">
                <h3 className="text-white font-semibold mb-3">Photo Collage</h3>
                <div className="flex items-center justify-center h-40 text-gray-500">
                    <p className="text-sm">Add more photos to generate collages</p>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-gray-800/60 backdrop-blur rounded-2xl p-6 border border-gray-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Photo Collage</h3>
                <div className="flex items-center gap-2">
                    <select
                        value={mode}
                        onChange={e => handleModeChange(e.target.value as LayoutMode)}
                        className="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                    >
                        <option value="grid">Grid</option>
                        <option value="feature">Feature</option>
                        <option value="mosaic">Mosaic</option>
                    </select>
                    <button
                        onClick={handleRegenerate}
                        disabled={loading}
                        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1 rounded border border-gray-600 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Generating...' : 'Regenerate'}
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={!previewUrl || loading}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition-colors disabled:opacity-50"
                    >
                        Export PNG
                    </button>
                </div>
            </div>

            {/* Canvas (hidden, used for rendering) */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Preview */}
            <div className="relative rounded-xl overflow-hidden bg-gray-900">
                {loading && !previewUrl && (
                    <div className="flex items-center justify-center h-48">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
                {previewUrl && (
                    <img
                        src={previewUrl}
                        alt="Photo collage"
                        className="w-full h-auto rounded-xl"
                    />
                )}
                {loading && previewUrl && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-xl">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
            </div>
        </div>
    )
}
