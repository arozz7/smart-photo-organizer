import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PersonFaceItem from '../components/PersonFaceItem';

interface Face {
    id: number;
    photo_id: number;
    box: { x: number, y: number, width: number, height: number };
    descriptor: number[];
    person_id: number | null;
    file_path: string;
    preview_cache_path: string;
    width: number;
    height: number;
    is_ignored: boolean;
}

interface Person {
    id: number;
    name: string;
}

const PersonDetail = () => {
    const { personId } = useParams();
    const navigate = useNavigate();
    const [person, setPerson] = useState<Person | null>(null);
    const [faces, setFaces] = useState<Face[]>([]);
    const [selectedFaces, setSelectedFaces] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(true);
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);

    useEffect(() => {
        loadData();
    }, [personId]);

    const loadData = async () => {
        if (!personId) return;
        setLoading(true);
        try {
            // @ts-ignore
            const p = await window.ipcRenderer.invoke('db:getPerson', parseInt(personId));
            setPerson(p);

            // @ts-ignore
            const allFaces = await window.ipcRenderer.invoke('db:getAllFaces', {
                limit: 1000,
                filter: { personId: parseInt(personId) }
            });
            setFaces(allFaces);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const toggleSelection = useCallback((faceId: number) => {
        setSelectedFaces(prev => {
            const newSet = new Set(prev);
            if (newSet.has(faceId)) {
                newSet.delete(faceId);
            } else {
                newSet.add(faceId);
            }
            return newSet;
        });
    }, []);

    const handleReassign = async (name: string) => {
        if (!name) return;

        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: Array.from(selectedFaces),
                personName: name
            });

            if (result.success) {
                setSelectedFaces(new Set());
                setIsRenameModalOpen(false);
                loadData();
            } else {
                alert('Failed to move faces: ' + result.error);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to move faces');
        }
    };

    const openRenameModal = () => {
        if (selectedFaces.size === 0) return;
        setIsRenameModalOpen(true);
    };

    const handleUnassign = async () => {
        if (selectedFaces.size === 0) return;
        if (!confirm(`Remove ${selectedFaces.size} faces from ${person?.name}?`)) return;

        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:unassignFaces', Array.from(selectedFaces));
            setSelectedFaces(new Set());
            loadData(); // Refresh
        } catch (err) {
            console.error(err);
            alert('Failed to remove faces');
        }
    };

    if (loading) return <div className="p-8 text-white">Loading...</div>;
    if (!person) return <div className="p-8 text-white">Person not found</div>;

    return (
        <div className="h-full flex flex-col bg-gray-900 text-white p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-800 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-3xl font-bold">{person.name}</h1>
                    <span className="text-gray-400 text-sm">({faces.length} faces)</span>
                </div>

                {selectedFaces.size > 0 && (
                    <div className="flex gap-2">
                        <button
                            onClick={openRenameModal}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
                        >
                            Move / Rename ({selectedFaces.size})
                        </button>
                        <button
                            onClick={handleUnassign}
                            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
                        >
                            Remove ({selectedFaces.size})
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto pr-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {faces.map(face => (
                        <PersonFaceItem
                            key={face.id}
                            face={face}
                            isSelected={selectedFaces.has(face.id)}
                            toggleSelection={toggleSelection}
                        />
                    ))}
                </div>
            </div>

            <RenameModal
                isOpen={isRenameModalOpen}
                onClose={() => setIsRenameModalOpen(false)}
                onConfirm={handleReassign}
                initialValue=""
                count={selectedFaces.size}
            />
        </div>
    );
};

// Simple Modal Component
const RenameModal = ({
    isOpen,
    onClose,
    onConfirm,
    initialValue,
    count
}: {
    isOpen: boolean,
    onClose: () => void,
    onConfirm: (name: string) => void,
    initialValue: string,
    count: number
}) => {
    const [name, setName] = useState(initialValue);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [allPeopleNames, setAllPeopleNames] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            setName(initialValue);
            fetchPeople();
        }
    }, [isOpen, initialValue]);

    const fetchPeople = async () => {
        try {
            // @ts-ignore
            const people = await window.ipcRenderer.invoke('db:getPeople');
            console.log('API db:getPeople returned:', people);
            setAllPeopleNames(people.map((p: any) => p.name));
        } catch (err) {
            console.error('Failed to fetch people for autocomplete', err);
        }
    };

    useEffect(() => {
        if (name.length > 0) {
            const filtered = allPeopleNames
                .filter(p => p.toLowerCase().includes(name.toLowerCase()) && p !== name)
                .slice(0, 50);
            setSuggestions(filtered);
        } else {
            // Show first 50 people as default suggestions
            setSuggestions(allPeopleNames.slice(0, 50));
        }
    }, [name, allPeopleNames]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
            onClick={onClose}
        >
            <div
                className="bg-gray-800 p-6 rounded-xl shadow-2xl w-full max-w-md border border-gray-700"
                onClick={e => e.stopPropagation()}
            >
                <h3 className="text-xl font-bold text-white mb-2">Move {count} Faces</h3>
                <p className="text-gray-400 mb-4 text-sm">Enter the name of the person to move these faces to. Select from existing people or create a new one.</p>

                <div className="relative mb-6">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Person Name"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') onConfirm(name);
                            if (e.key === 'Escape') onClose();
                        }}
                    />
                    {suggestions.length > 0 && (
                        <div className="bg-gray-800 border border-gray-700 mt-1 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
                            {suggestions.map((suggestion, idx) => (
                                <div
                                    key={idx}
                                    className="px-4 py-2 hover:bg-indigo-600 cursor-pointer text-gray-200"
                                    onClick={() => setName(suggestion)}
                                >
                                    {suggestion}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(name)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Move Faces
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PersonDetail;
