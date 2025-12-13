import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePeople } from '../context/PeopleContext'
import PersonCard from '../components/PersonCard'
import FaceGrid from '../components/FaceGrid'

export default function People() {
    const navigate = useNavigate()
    const { people, faces, loadPeople, loadFaces, loading } = usePeople()
    const [activeTab, setActiveTab] = useState<'identified' | 'unnamed'>('identified')

    useEffect(() => {
        loadPeople()
    }, [])

    useEffect(() => {
        if (activeTab === 'unnamed') {
            loadFaces({ unnamed: true })
        }
    }, [activeTab])

    return (
        <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
            {/* Header / Tabs */}
            <div className="flex-none p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl z-10">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                        People
                    </h1>
                </div>

                <div className="flex space-x-1 bg-gray-800/50 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setActiveTab('identified')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'identified'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        Identified People <span className="ml-2 opacity-50 text-xs">({people.length})</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('unnamed')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'unnamed'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        Unnamed Faces
                    </button>
                    {activeTab === 'unnamed' && faces.length > 0 && (
                        <button
                            onClick={async () => {
                                if (!confirm(`Are you sure you want to ignore all ${faces.length} visible faces?`)) return;
                                try {
                                    const faceIds = faces.map(f => f.id);
                                    // @ts-ignore
                                    await window.ipcRenderer.invoke('db:ignoreFaces', faceIds);
                                    loadFaces({ unnamed: true }); // Refresh
                                } catch (e) {
                                    console.error(e);
                                    alert('Failed to ignore faces');
                                }
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 text-sm rounded-md ml-4 transition-colors"
                        >
                            Ignore All Visible
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {activeTab === 'identified' ? (
                    <div className="p-6">
                        {people.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-20 text-gray-500 border border-dashed border-gray-800 rounded-2xl">
                                <span className="text-6xl mb-4">👥</span>
                                <h3 className="text-xl font-medium mb-2">No people identified yet</h3>
                                <p className="max-w-md text-center">
                                    Start by naming faces in the "Unnamed Faces" tab.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                                {people.map(person => (
                                    <PersonCard
                                        key={person.id}
                                        person={person}
                                        onClick={() => navigate(`/people/${person.id}`)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full">
                        {loading && faces.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                            </div>
                        ) : (
                            <FaceGrid faces={faces} />
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
