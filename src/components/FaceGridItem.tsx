import { useState, useEffect, useRef } from 'react'
import { usePeople } from '../context/PeopleContext'
import FaceThumbnail from './FaceThumbnail'
import { useScan } from '../context/ScanContext'

interface FaceGridItemProps {
    face: any
    isSelected: boolean
    onSelect: (faceId: number | null) => void
    onNameSubmit: (faceId: number, name: string) => Promise<void>
    isMultiSelected?: boolean
    onToggleMultiSelect?: (faceId: number) => void
}

export default function FaceGridItem({ face, isSelected, onSelect, onNameSubmit, isMultiSelected, onToggleMultiSelect }: FaceGridItemProps) {
    const { ignoreFace, people } = usePeople()
    const { viewPhoto } = useScan()
    const [nameInput, setNameInput] = useState('')
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [selectedIndex, setSelectedIndex] = useState(-1)
    const inputRef = useRef<HTMLInputElement>(null)

    // Reset input when not selected
    useEffect(() => {
        if (!isSelected) {
            setNameInput('')
            setSuggestions([])
        } else {
            // Focus on mount/select
            // User reports minimizing/restoring window fixes it -> Suggests window focus loss.
            // Force window focus first.
            if (window.focus) window.focus();

            // Use requestAnimationFrame + setTimeout to ensure paint is done and focus is ready
            requestAnimationFrame(() => {
                setTimeout(() => {
                    if (inputRef.current) {
                        if (window.focus) window.focus();
                        inputRef.current.focus({ preventScroll: true });
                    }
                }, 150);
            });
        }
    }, [isSelected])

    // Handle window focus to restore input focus
    useEffect(() => {
        if (!isSelected) return;

        const handleWindowFocus = () => {
            // Explicitly request app window focus in Electron
            // @ts-ignore
            if (window.ipcRenderer) window.ipcRenderer.invoke('app:focusWindow');
            if (inputRef.current) inputRef.current.focus({ preventScroll: true });
        };

        window.addEventListener('focus', handleWindowFocus);
        return () => window.removeEventListener('focus', handleWindowFocus);
    }, [isSelected]);

    // Update suggestions upon input
    useEffect(() => {
        if (!isSelected) return

        if (!nameInput.trim()) {
            setSuggestions([])
            setSelectedIndex(-1)
            return
        }
        const lowerInput = nameInput.toLowerCase()
        const filtered = people
            .map(p => p.name)
            .filter(name => name.toLowerCase().includes(lowerInput) && name !== nameInput)
            .slice(0, 10) // Small list is better
        setSuggestions(filtered)
        setSelectedIndex(-1)
    }, [nameInput, people, isSelected])

    const handleSubmit = async () => {
        if (!nameInput.trim()) return
        await onNameSubmit(face.id, nameInput.trim())
    }

    return (
        <div className="relative group">
            <div
                className={`aspect-square bg-gray-800 rounded-lg overflow-hidden relative cursor-pointer ring-offset-2 ring-offset-black transition-all ${isSelected || isMultiSelected ? 'ring-2 ring-indigo-500' : 'hover:ring-2 hover:ring-indigo-500'}`}
                onClick={() => onSelect(isSelected ? null : face.id)}
            >
                <FaceThumbnail
                    src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                    fallbackSrc={`local-resource://${encodeURIComponent(face.file_path)}`}
                    box={face.box}
                    originalImageWidth={face.width}
                    className="w-full h-full"
                />

                {/* Hover Overlay */}
                <div className={`absolute inset-0 bg-black/20 transition-colors ${isSelected ? 'bg-transparent' : 'group-hover:bg-transparent'}`} />

                {/* Debug Button - Solid Red, Top Left */}
                {/* Debug Button - Only show if specifically enabled or dev mode (currently removed for prod) */}
                {/* 
                <button
                   ...
                />
                */}

                {/* Multi-Select Checkbox */}
                {onToggleMultiSelect && (
                    <div
                        className={`absolute top-2 left-2 z-10 transition-opacity ${isMultiSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleMultiSelect(face.id);
                        }}
                    >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isMultiSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-black/40 border-white/70 hover:bg-black/60'
                            }`}>
                            {isMultiSelected && (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                            )}
                        </div>
                    </div>
                )}

                {/* Ignore Button */}
                {!isSelected && !isMultiSelected && (
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

                {/* View Original Button */}
                {!isSelected && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            viewPhoto(face.photo_id);
                        }}
                        className="absolute bottom-1 right-1 bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all"
                        title="View Original Photo"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
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
                            autoFocus
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                if (document.activeElement !== e.currentTarget) {
                                    e.currentTarget.focus();
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setSelectedIndex(prev => (prev > -1 ? prev - 1 : -1));
                                } else if (e.key === 'Enter') {
                                    if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
                                        const selectedName = suggestions[selectedIndex];
                                        setNameInput(selectedName);
                                        onNameSubmit(face.id, selectedName);
                                        setSuggestions([]);
                                    } else {
                                        handleSubmit();
                                    }
                                } else if (e.key === 'Escape') {
                                    if (suggestions.length > 0) {
                                        setSuggestions([]);
                                    } else {
                                        onSelect(null);
                                    }
                                }
                            }}
                            onFocus={() => {
                                if (!nameInput) {
                                    const initial = people.map(p => p.name).slice(0, 5);
                                    setSuggestions(initial);
                                }
                            }}
                        />

                        <div className="flex justify-between items-center mb-1">
                            <button onClick={() => onSelect(null)} className="text-[10px] text-gray-500 hover:text-white px-1">Cancel</button>
                            <button onClick={handleSubmit} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold px-1">Save</button>
                        </div>

                        {/* Suggestions List - Now below buttons or absolute relative to container */}
                        {suggestions.length > 0 && (
                            <div className="bg-gray-900/95 border border-gray-700 rounded overflow-hidden shadow-2xl mt-1">
                                {suggestions.map((name, idx) => (
                                    <div
                                        key={idx}
                                        className={`px-2 py-1.5 cursor-pointer text-[11px] border-b border-gray-800/50 last:border-0 transition-colors ${selectedIndex === idx ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setNameInput(name);
                                            onNameSubmit(face.id, name);
                                            setSuggestions([]);
                                        }}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                    >
                                        {name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
