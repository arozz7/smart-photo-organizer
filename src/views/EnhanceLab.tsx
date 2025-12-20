import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeftIcon, MagicWandIcon, DownloadIcon, ReloadIcon } from '@radix-ui/react-icons'
import BeforeAfterSlider from '../components/BeforeAfterSlider'
import { useAlert } from '../context/AlertContext'

export default function EnhanceLab() {
    const { photoId } = useParams() // Expecting /enhance/:photoId
    const navigate = useNavigate()
    const { showAlert } = useAlert()

    // State
    const [originalPath, setOriginalPath] = useState('')
    const [enhancedPath, setEnhancedPath] = useState('')
    const [loading, setLoading] = useState(false)
    const [modelLoading, setModelLoading] = useState(false)
    const [error, setError] = useState('')

    // Config
    const [task, setTask] = useState('upscale') // 'upscale' | 'restore_faces'
    const [modelName, setModelName] = useState('RealESRGAN_x4plus')
    const [faceEnhance, setFaceEnhance] = useState(false)

    // Fix: Use useLocation for proper state access
    // But since I am editing keeping existing structure:

    // Actually, I need to fetch if 'originalPath' is empty and 'statePhoto' is empty.
    useEffect(() => {
        const loadPhoto = async () => {
            if (originalPath) return;

            try {
                // @ts-ignore
                const photo = await window.ipcRenderer.invoke('db:getPhoto', parseInt(photoId));
                if (photo) {
                    setOriginalPath(photo.preview_cache_path || photo.file_path);
                } else {
                    setError('Photo not found');
                }
            } catch (err) {
                console.error(err);
                setError('Failed to load photo');
            }
        }

        // Pass location state check inside effect or rely on render?
        // Let's rely on fetch if render state is missing.
        loadPhoto();
    }, [photoId, originalPath])

    const handleEnhance = async () => {
        setLoading(true)
        setError('')
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:enhanceImage', {
                photoId: parseInt(photoId!),
                task,
                modelName,
                faceEnhance
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
                showAlert({
                    title: 'Model Downloaded',
                    description: 'Model weights have been downloaded successfully!'
                });
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
    const location = useLocation()
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
                                onClick={() => {
                                    setTask('upscale');
                                    if (modelName === 'GFPGANv1.4') setModelName('RealESRGAN_x4plus');
                                }}
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
                            disabled={task === 'restore_faces'}
                        >
                            {task === 'upscale' ? (
                                <>
                                    <option value="RealESRGAN_x4plus">Real-ESRGAN x4 Plus (General)</option>
                                    <option value="RealESRGAN_x4plus_anime_6B">Real-ESRGAN x4 Anime</option>
                                </>
                            ) : (
                                <option value="GFPGANv1.4">GFPGAN v1.4 (Faces)</option>
                            )}
                        </select>
                    </div>

                    {task === 'upscale' && (
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="faceEnhance"
                                checked={faceEnhance}
                                onChange={e => setFaceEnhance(e.target.checked)}
                                className="w-4 h-4 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label htmlFor="faceEnhance" className="text-sm text-gray-300 select-none cursor-pointer">
                                Enhance Faces (Slower)
                            </label>
                        </div>
                    )}

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
                        originalSrc={`local-resource://${encodeURIComponent(displayPath.replace(/\\/g, '/'))}`}
                        enhancedSrc={`local-resource://${encodeURIComponent(enhancedPath.replace(/\\/g, '/'))}?t=${Date.now()}`}
                    />
                ) : (
                    <img
                        src={`local-resource://${encodeURIComponent(displayPath.replace(/\\/g, '/'))}`}
                        className="max-w-full max-h-full object-contain"
                    />
                )}
            </div>
        </div>
    )
}
