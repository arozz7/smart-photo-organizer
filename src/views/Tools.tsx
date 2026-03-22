import { useState } from 'react';
import BlurryPhotosPanel from '../components/BlurryPhotosPanel'
import CreativeToolsPanel from '../components/CreativeToolsPanel'

type Tool = 'blurry-photos' | 'creative-tools'

const TOOLS: { id: Tool; label: string; description: string }[] = [
    {
        id: 'blurry-photos',
        label: 'Blurry Photo Export',
        description: 'Find and export a list of photos below a sharpness threshold.',
    },
    {
        id: 'creative-tools',
        label: 'Creative Tools',
        description: 'Segment and edit photos using SAM 3 AI — remove backgrounds, isolate subjects, blur regions.',
    },
]

export default function Tools() {
    const [activeTool, setActiveTool] = useState<Tool>('blurry-photos')

    return (
        <div className="flex h-full">
            {/* Tool picker sidebar */}
            <aside className="w-56 bg-gray-800/60 border-r border-gray-700 p-3 space-y-1 flex-shrink-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-2">
                    Library Tools
                </p>
                {TOOLS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTool(t.id)}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                            activeTool === t.id
                                ? 'bg-indigo-600 text-white'
                                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </aside>

            {/* Tool content */}
            <div className="flex-1 overflow-hidden">
                {activeTool === 'blurry-photos' && <BlurryPhotosPanel />}
                {activeTool === 'creative-tools' && <CreativeToolsPanel />}
            </div>
        </div>
    )
}
