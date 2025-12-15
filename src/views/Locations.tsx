import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useScan } from '../context/ScanContext'

interface LibraryStats {
    totalPhotos: number
    fileTypes: { type: string, count: number }[]
    folders: { folder: string, count: number }[]
}

export default function Locations() {
    const [stats, setStats] = useState<LibraryStats | null>(null)
    const [loading, setLoading] = useState(true)
    const navigate = useNavigate()
    const { setFilter } = useScan()

    useEffect(() => {
        const load = async () => {
            try {
                // @ts-ignore
                const res = await window.ipcRenderer.invoke('db:getLibraryStats')
                if (res.success) {
                    setStats(res.stats)
                }
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    const handleFolderClick = (folder: string) => {
        setFilter({ folder })
        navigate('/')
    }

    if (loading) return <div className="p-8 text-gray-400">Loading statistics...</div>

    if (!stats) return <div className="p-8 text-red-400">Failed to load statistics.</div>

    return (
        <div className="p-8 h-full overflow-y-auto bg-gray-900 text-gray-100">
            <h2 className="text-3xl font-bold mb-8 text-white">Library Overview</h2>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h3 className="text-gray-400 text-sm font-medium uppercase">Total Photos</h3>
                    <p className="text-4xl font-bold text-white mt-2">{stats.totalPhotos.toLocaleString()}</p>
                </div>
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h3 className="text-gray-400 text-sm font-medium uppercase">Total Folders</h3>
                    <p className="text-4xl font-bold text-indigo-400 mt-2">{stats.folders.length}</p>
                </div>
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h3 className="text-gray-400 text-sm font-medium uppercase">File Types</h3>
                    <div className="mt-2 text-sm text-gray-300 space-y-1">
                        {stats.fileTypes.slice(0, 5).map(ft => (
                            <div key={ft.type} className="flex justify-between">
                                <span>{ft.type || 'Unknown'}</span>
                                <span className="font-mono text-gray-500">{ft.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Folder List */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-700">
                    <h3 className="text-lg font-semibold text-white">Scanned Locations</h3>
                </div>
                <div className="divide-y divide-gray-700">
                    {stats.folders.map((f) => (
                        <div
                            key={f.folder}
                            className="px-6 py-4 hover:bg-gray-700/50 transition-colors flex items-center justify-between group cursor-pointer"
                            onClick={() => handleFolderClick(f.folder)}
                        >
                            <div className="flex items-center gap-3">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 group-hover:text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                                </svg>
                                <div className="text-sm font-medium text-gray-200 group-hover:text-white break-all">{f.folder}</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-gray-500">{f.count} photos</span>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600 group-hover:text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                            </div>
                        </div>
                    ))}
                    {stats.folders.length === 0 && (
                        <div className="px-6 py-8 text-center text-gray-500">
                            No locations found. Scan a folder to get started.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
