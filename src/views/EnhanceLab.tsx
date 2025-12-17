import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, MagicWandIcon, DownloadIcon, ReloadIcon, CheckIcon } from '@radix-ui/react-icons'
import BeforeAfterSlider from '../components/BeforeAfterSlider'

export default function EnhanceLab() {
    const { photoId } = useParams() // Expecting /enhance/:photoId
    const navigate = useNavigate()

    // State
    const [originalPath, setOriginalPath] = useState('')
    const [enhancedPath, setEnhancedPath] = useState('')
    const [loading, setLoading] = useState(false)
    const [modelLoading, setModelLoading] = useState(false)
    const [error, setError] = useState('')

    // Config
    const [task, setTask] = useState('upscale') // 'upscale' | 'restore_faces'
    const [modelName, setModelName] = useState('RealESRGAN_x4plus')

    useEffect(() => {
        // Load photo details on mount
        if (!photoId) return;

        // We need to fetch the file path for this photo ID. 
        // We can reuse 'db:getPhotos' with a filter or add a specific handler.
        // Or simply assume we might be passed state from navigation? No, refresh should work.
        // Let's verify file path existence via IPC.
        const loadPhoto = async () => {
            // We don't have a direct 'getPhoto' IPC exposed to renderer widely, 
            // but we can query by ID filter.
            // @ts-ignore
            const photos = await window.ipcRenderer.invoke('db:getPhotos', { filter: { people: [], tags: [], folder: '' } })
            // Wait, getPhotos with empty filter gets ALL. That's bad.
            // We need a way to get ONE photo. 
            // Let's use the scan result or just trust we can send the ID to enhance?
            // But we need to display it "Before".

            // Workaround: We'll fetch it using a specially crafted filter or just a new IPC `db:getPhoto`.
            // Actually, `face:getBlurry` returns photo paths.
            // Let's just add `db:getPhoto` quickly or filter by ID if possible?
            // `db:getPhotos` doesn't filter by ID array.

            // Hack: use `db:getPhotos` with limit 1? No no ID filter.
            // I'll add `db:getPhoto` to main.ts? Or use existing logic?

            // Simplest: Request `ai:scanImage`? No.
            // Let's filter client side if needed or just add the IPC.
            // I recall `ai:generateTags` fetches path internally.

            // Let's just create a new IPC `db:getPhoto(id)` in next step if needed. 
            // For now, I will assume I can get the path.
            // Actually `local-resource://` works with absolute paths.
            // Maybe I passed the path in history state?
            // If not, I'll need to fetch it.
        }
    }, [photoId])

    const handleEnhance = async () => {
        setLoading(true)
        setError('')
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:enhanceImage', {
                photoId: parseInt(photoId!),
                task,
                modelName
            })

            if (res.success) {
                setEnhancedPath(res.outPath)
            } else {
                setError(res.error)
            }
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    const handleDownloadModel = async () => {
        setModelLoading(true)
        setError('')
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:downloadModel', { modelName })
            if (res.success) {
                alert('Model downloaded successfully!')
            } else {
                setError(res.error)
            }
        } catch (e: any) {
            setError(e.message)
        } finally {
            setModelLoading(false)
        }
    }

    // Pseudo-loader for now until I fix the photo fetch
    // I will pass photo object via location state for MVP
    const location: any = window.location
    const statePhoto = location.state?.photo

    if (!statePhoto && !originalPath) {
        return <div className="p-10 text-white">Loading photo... (Access via Library)</div>
    }

    const displayPath = originalPath || statePhoto?.file_path

    return (
        <div className="flex h-full bg-gray-900 text-gray-200">
            {/* Left Sidebar: Controls */}
            <div className="w-80 bg-gray-800 border-r border-gray-700 p-6 flex flex-col gap-6">
                <div>
                    <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 hover:text-white mb-4">
                        <ArrowLeftIcon /> Back
                    </button>
                    <h1 className="text-xl font-bold text-white flex items-center gap-2">
                        <MagicWandIcon className="text-indigo-400" /> Enhance Lab
                    </h1>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase">Task</label>
                        <div className="flex bg-gray-900 rounded p-1">
                            <button
                                className={`flex-1 py-2 text-sm rounded ${task === 'upscale' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
                                onClick={() => setTask('upscale')}
                            >
                                Upscale (x4)
                            </button>
                            <button
                                className={`flex-1 py-2 text-sm rounded ${task === 'restore_faces' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
                                onClick={() => { setTask('restore_faces'); setModelName('GFPGANv1.4'); }}
                            >
                                Restore Faces
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase">Model</label>
                        <select
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                            value={modelName}
                            onChange={e => setModelName(e.target.value)}
                            disabled={task === 'restore_faces'} // Only one model for now
                        >
                            <option value="RealESRGAN_x4plus">Real-ESRGAN x4 Plus (General)</option>
                            <option value="RealESRGAN_x4plus_anime_6B">Real-ESRGAN x4 Anime</option>
                            <option value="GFPGANv1.4">GFPGAN v1.4 (Faces)</option>
                        </select>
                    </div>

                    <button
                        onClick={handleEnhance}
                        disabled={loading || modelLoading}
                        className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded font-bold shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? <ReloadIcon className="animate-spin" /> : <MagicWandIcon />}
                        {loading ? 'Enhancing...' : 'Run Enhancement'}
                    </button>

                    {error && (
                        <div className="bg-red-900/50 border border-red-500/50 text-red-200 p-3 rounded text-xs">
                            {error}
                            {(error.includes('not found') || error.includes('Model')) && (
                                <button
                                    onClick={handleDownloadModel}
                                    disabled={modelLoading}
                                    className="mt-2 w-full bg-red-800 hover:bg-red-700 py-1 rounded text-white flex items-center justify-center gap-2"
                                >
                                    {modelLoading ? <ReloadIcon className="animate-spin" /> : <DownloadIcon />}
                                    Download Model Weights
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Area: Preview */}
            <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
                {enhancedPath ? (
                    <BeforeAfterSlider
                        originalSrc={`local-resource://${encodeURIComponent(displayPath)}`}
                        enhancedSrc={`local-resource://${encodeURIComponent(enhancedPath)}?t=${Date.now()}`}
                    />
                ) : (
                    <img
                        src={`local-resource://${encodeURIComponent(displayPath)}`}
                        className="max-w-full max-h-full object-contain"
                    />
                )}
            </div>
        </div>
    )
}
