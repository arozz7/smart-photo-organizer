import { useState, useEffect, useRef } from 'react'
import { usePeople } from '../context/PeopleContext'
import FaceThumbnail, { FaceDebugOverlay } from './FaceThumbnail'

interface FaceGridItemProps {
    face: any
    isSelected: boolean
    onSelect: (faceId: number | null) => void
    onNameSubmit: (faceId: number, name: string) => Promise<void>
}

export default function FaceGridItem({ face, isSelected, onSelect, onNameSubmit }: FaceGridItemProps) {
    const { ignoreFace, people } = usePeople()
    const [nameInput, setNameInput] = useState('')
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [showDebug, setShowDebug] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    // Reset input when not selected
    useEffect(() => {
        if (!isSelected) {
            setNameInput('')
            setSuggestions([])
        } else {
            // Focus on mount/select
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [isSelected])

    // Update suggestions upon input
    useEffect(() => {
        if (!isSelected) return

        if (!nameInput.trim()) {
            setSuggestions([])
            return
        }
        const lowerInput = nameInput.toLowerCase()
        const filtered = people
            .map(p => p.name)
            .filter(name => name.toLowerCase().includes(lowerInput) && name !== nameInput)
            .slice(0, 50)
        setSuggestions(filtered)
    }, [nameInput, people, isSelected])

    const handleSubmit = async () => {
        if (!nameInput.trim()) return
        await onNameSubmit(face.id, nameInput.trim())
    }

    return (
        <div className="relative group">
            <div
                className={`aspect-square bg-gray-800 rounded-lg overflow-hidden relative cursor-pointer ring-offset-2 ring-offset-black transition-all ${isSelected ? 'ring-2 ring-indigo-500' : 'hover:ring-2 hover:ring-indigo-500'}`}
                onClick={() => onSelect(isSelected ? null : face.id)}
            >
                <FaceThumbnail
                    src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    box={face.box}
                    className="w-full h-full"
                />

                {/* Hover Overlay */}
                <div className={`absolute inset-0 bg-black/20 transition-colors ${isSelected ? 'bg-transparent' : 'group-hover:bg-transparent'}`} />

                {/* Debug Button - Solid Red, Top Left */}
                <button
                    className="absolute top-2 left-2 p-1.5 bg-red-600 text-white rounded-full z-40 shadow-lg hover:bg-red-700 transition-all"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowDebug(true);
                    }}
                    title="Debug Face Crop"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                </button>

                {/* Ignore Button */}
                {!isSelected && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            ignoreFace(face.id);
                        }}
                        className="absolute top-1 right-1 bg-black/50 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all"
                        title="Ignore this face"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Quick Name Input (Overlay) */}
            {isSelected && (
                <div
                    className="absolute top-full left-0 right-0 z-[100] mt-2 bg-gray-800 p-2 rounded shadow-xl border border-gray-700"
                    onClick={e => e.stopPropagation()} // Prevent closing when clicking inside
                >
                    <div className="relative">
                        <input
                            ref={inputRef}
                            type="text"
                            className="w-full bg-black/50 border border-gray-600 rounded px-2 py-1 text-xs text-white mb-2 focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="Name..."
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSubmit();
                                if (e.key === 'Escape') onSelect(null);
                            }}
                            onFocus={() => {
                                if (!nameInput) setSuggestions(people.map(p => p.name).slice(0, 5));
                            }}
                        />
                        {/* Suggestions List */}
                        {suggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-600 rounded mt-1 z-50 max-h-32 overflow-y-auto shadow-lg">
                                {suggestions.map((name, idx) => (
                                    <div
                                        key={idx}
                                        className="px-2 py-1 hover:bg-indigo-600 cursor-pointer text-xs text-gray-200"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            // Directly checking logic for suggestion click
                                            setNameInput(name); // Visual update
                                            onNameSubmit(face.id, name); // Submit immediately
                                            setSuggestions([]);
                                        }}
                                    >
                                        {name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-between">
                        <button onClick={() => onSelect(null)} className="text-xs text-gray-400 hover:text-white">Cancel</button>
                        <button onClick={handleSubmit} className="text-xs text-indigo-400 hover:text-indigo-300 font-bold">Save</button>
                    </div>
                </div>
            )}
            {showDebug && (
                <FaceDebugOverlay
                    src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    box={face.box}
                    onClose={() => setShowDebug(false)}
                />
            )}
        </div>
    )
}
