import React, { useState, useEffect, useRef } from 'react';
import { usePeople } from '../context/PeopleContext';
import { Spinner } from './ui/Spinner';
import { MagicWandIcon, PersonIcon } from '@radix-ui/react-icons';

interface PersonNameInputProps {
    value: string;
    onChange: (name: string) => void;
    onSelect?: (personId: number, name: string) => void;
    onCommit?: () => void; // Called on Enter key

    // Optional: Face descriptors for AI suggestions
    descriptors?: number[][];
    threshold?: number;

    // Optional: UI variants
    placeholder?: string;
    autoFocus?: boolean;
    showSuggestions?: boolean;
    maxSuggestions?: number;
    className?: string;
}

interface Suggestion {
    personId: number;
    personName: string;
    similarity: number;
    count: number;
}

export const PersonNameInput: React.FC<PersonNameInputProps> = ({
    value,
    onChange,
    onSelect,
    onCommit,
    descriptors,
    threshold,
    placeholder = "Enter person name...",
    autoFocus = false,
    showSuggestions = true,
    maxSuggestions = 3,
    className = ''
}) => {
    const { matchBatch, people, fetchFacesByIds, smartIgnoreSettings } = usePeople();
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [filteredPeople, setFilteredPeople] = useState<any[]>([]);
    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const effectiveThreshold = threshold ?? (smartIgnoreSettings?.aiSuggestionThreshold ?? 0.6);
    const aiEnabled = smartIgnoreSettings?.enableAiSuggestions ?? true;

    const [focusedIndex, setFocusedIndex] = useState<number>(-1);

    // AI Suggestion Logic
    useEffect(() => {
        if (!descriptors || descriptors.length === 0 || !showSuggestions || !aiEnabled) {
            setSuggestions([]);
            return;
        }

        let isMounted = true;
        const fetchSuggestions = async () => {
            setIsThinking(true);
            try {
                // Limit to 5 samples to save resources
                const sample = descriptors.slice(0, 5);

                // 1. Get raw matches for each face
                const batchResults = await matchBatch(sample, { threshold: effectiveThreshold, limit: maxSuggestions });
                if (!isMounted) return;

                if (!batchResults || !Array.isArray(batchResults)) {
                    console.warn("Invalid batch match results:", batchResults);
                    setSuggestions([]);
                    return;
                }

                // 2. Aggregate all matched face IDs
                const allFaceIds = new Set<number>();
                batchResults.forEach((matches: any[]) => {
                    if (Array.isArray(matches)) {
                        matches.forEach(m => allFaceIds.add(m.id));
                    }
                });

                if (allFaceIds.size === 0) {
                    setSuggestions([]);
                    return;
                }

                // 3. Resolve Face IDs to People using DB
                const faces = await fetchFacesByIds(Array.from(allFaceIds));
                if (!isMounted) return;

                // 4. Vote for people
                const personVotes = new Map<number, { name: string, score: number, count: number }>();

                faces.forEach((face: any) => {
                    if (face.person_id && face.person_name) {
                        const existing = personVotes.get(face.person_id) || { name: face.person_name, score: 0, count: 0 };
                        // Simple voting: count occurrences. 
                        // Could be improved by weighting with distance (1 - distance)
                        existing.count++;
                        existing.score += 1;
                        personVotes.set(face.person_id, existing);
                    }
                });

                // 5. Sort and format
                const ranked = Array.from(personVotes.entries())
                    .map(([id, data]) => ({
                        personId: id,
                        personName: data.name,
                        count: data.count,
                        // Pseudo-similarity based on consensus (just for display)
                        similarity: Math.min(0.99, 0.5 + (data.count / (sample.length * 5)))
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, maxSuggestions);

                setSuggestions(ranked);

            } catch (err) {
                console.error("AI Suggestion Error:", err);
            } finally {
                if (isMounted) setIsThinking(false);
            }
        };

        // Debounce slightly to avoid rapid firing on selection changes
        const timeout = setTimeout(fetchSuggestions, 500);
        return () => {
            isMounted = false;
            clearTimeout(timeout);
        };

    }, [descriptors, effectiveThreshold, matchBatch, showSuggestions, fetchFacesByIds, maxSuggestions, aiEnabled]);

    // Autocomplete Logic
    useEffect(() => {
        if (!value || value.trim() === '') {
            setFilteredPeople([]);
            setShowAutocomplete(false);
            setFocusedIndex(-1); // Reset focus
            return;
        }

        const lowerVal = value.toLowerCase();
        const matches = people
            .filter(p => p.name.toLowerCase().includes(lowerVal))
            .sort((a, b) => {
                // Prioritize startsWith
                const aStarts = a.name.toLowerCase().startsWith(lowerVal);
                const bStarts = b.name.toLowerCase().startsWith(lowerVal);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return b.face_count - a.face_count; // Then by frequency
            })
            .slice(0, 5);

        setFilteredPeople(matches);
        setFocusedIndex(-1); // Reset focus on new input
        // Do not force show here, relying on user input to show it
    }, [value, people]);

    // Click outside handler
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowAutocomplete(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSuggestionClick = (s: Suggestion) => {
        onChange(s.personName);
        if (onSelect) onSelect(s.personId, s.personName);
        setShowAutocomplete(false);
        inputRef.current?.focus();
    };

    const handlePersonSelect = (p: any) => {
        onChange(p.name);
        if (onSelect) onSelect(p.id, p.name);
        setShowAutocomplete(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Combined list for navigation: AI Suggestions then Autocomplete
        const aiItems = (!isThinking && showSuggestions && aiEnabled) ? suggestions : [];
        const autocompleteItems = (showAutocomplete) ? filteredPeople : [];
        const totalItems = aiItems.length + autocompleteItems.length;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (totalItems > 0) {
                setFocusedIndex(prev => (prev + 1) % totalItems);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (totalItems > 0) {
                setFocusedIndex(prev => (prev - 1 + totalItems) % totalItems);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();

            if (focusedIndex >= 0 && totalItems > 0) {
                // Determine what is selected
                if (focusedIndex < aiItems.length) {
                    handleSuggestionClick(aiItems[focusedIndex]);
                } else {
                    const acIndex = focusedIndex - aiItems.length;
                    handlePersonSelect(autocompleteItems[acIndex]);
                }
            } else {
                if (onCommit) onCommit();
                setShowAutocomplete(false);
            }
        } else if (e.key === 'Escape') {
            setShowAutocomplete(false);
            setFocusedIndex(-1);
            inputRef.current?.blur();
        }
    };

    // Determine which item is focused for rendering
    const aiItemsCount = (!isThinking && showSuggestions && aiEnabled) ? suggestions.length : 0;

    return (
        <div ref={wrapperRef} className={`flex flex-col gap-2 ${className}`}>

            {/* AI Suggestions Bar */}
            {(suggestions.length > 0 || isThinking) && showSuggestions && aiEnabled && (
                <div className="flex items-center flex-wrap gap-2 p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg animate-in slide-in-from-top-1 fade-in duration-200">
                    <div className="flex items-center gap-1.5 text-xs text-indigo-300 font-medium mr-1">
                        {isThinking ? (
                            <Spinner size="sm" className="border-indigo-400 border-t-transparent" />
                        ) : (
                            <MagicWandIcon className="w-3.5 h-3.5" />
                        )}
                        <span>Suggested:</span>
                    </div>

                    {!isThinking && suggestions.map((s, idx) => {
                        const isFocused = idx === focusedIndex;
                        return (
                            <button
                                key={s.personId}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSuggestionClick(s)}
                                className={`group flex items-center gap-1.5 px-2.5 py-1 text-white rounded-full text-xs font-medium transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-indigo-900/20
                                    ${isFocused ? 'bg-indigo-400 scale-105 ring-2 ring-white/20' : 'bg-indigo-600 hover:bg-indigo-500'}
                                `}
                                title={`Matched ${s.count} reference faces`}
                            >
                                {s.personName}
                                <span className="bg-black/20 px-1.5 rounded text-[10px] tabular-nums group-hover:bg-black/30">
                                    {Math.round(s.similarity * 100)}%
                                </span>
                            </button>
                        );
                    })}

                    {!isThinking && suggestions.length === 0 && descriptors && descriptors.length > 0 && (
                        <span className="text-xs text-gray-500 italic">No likely matches found</span>
                    )}
                </div>
            )}

            {/* Input Field */}
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <PersonIcon className="h-4 w-4 text-gray-400" />
                </div>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setShowAutocomplete(true);
                    }}
                    onFocus={() => setShowAutocomplete(filteredPeople.length > 0)}
                    onKeyDown={handleKeyDown}
                    className="block w-full pl-10 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm text-white placeholder-gray-500 transition-shadow"
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                />

                {/* Autocomplete Dropdown */}
                {showAutocomplete && filteredPeople.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                        <ul className="max-h-32 overflow-auto py-1">
                            {filteredPeople.map((person, idx) => {
                                const globalIndex = aiItemsCount + idx;
                                const isFocused = globalIndex === focusedIndex;
                                return (
                                    <li key={person.id}>
                                        <button
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => handlePersonSelect(person)}
                                            className={`w-full text-left px-4 py-2 flex items-center justify-between group transition-colors
                                                ${isFocused ? 'bg-indigo-600/30' : 'hover:bg-gray-700'}
                                            `}
                                        >
                                            <span className={`text-sm font-medium ${isFocused ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>
                                                {person.name}
                                            </span>
                                            <span className="text-xs text-gray-500 bg-gray-900 px-2 py-0.5 rounded-full group-hover:text-gray-400">
                                                {person.face_count} faces
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};
