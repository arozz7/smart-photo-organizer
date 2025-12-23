import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PersonFaceItem from '../components/PersonFaceItem';
import BlurryFacesModal from '../components/BlurryFacesModal';
import TargetedScanModal from '../components/TargetedScanModal';
import { useAlert } from '../context/AlertContext';
import { useAI } from '../context/AIContext';

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
    const [isBlurryModalOpen, setIsBlurryModalOpen] = useState(false);
    const [isNameEditOpen, setIsNameEditOpen] = useState(false);
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selectedFaces, setSelectedFaces] = useState<Set<number>>(new Set());
    const { showAlert, showConfirm } = useAlert();
    const { addToQueue } = useAI();
    const [isScanning, setIsScanning] = useState(false);
    const [isScanModalOpen, setIsScanModalOpen] = useState(false);

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
                showAlert({
                    title: 'Move Failed',
                    description: result.error,
                    variant: 'danger'
                });
            }
        } catch (err) {
            console.error(err);
            showAlert({
                title: 'Error',
                description: 'Failed to move faces',
                variant: 'danger'
            });
        }
    };

    const handleRenamePerson = async (newName: string) => {
        if (!newName || !person || !newName.trim()) return;

        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:renamePerson', {
                personId: person.id,
                newName: newName.trim()
            });

            if (result.success) {
                setIsNameEditOpen(false);
                if (result.merged) {
                    // Navigate to the target person (merged destination)
                    navigate(`/people/${result.targetId}`, { replace: true });
                } else {
                    // Just refresh
                    loadData();
                    // Also refresh global people list if we had context... but here we just show this person.
                }
            } else {
                showAlert({
                    title: 'Rename Failed',
                    description: result.error,
                    variant: 'danger'
                });
            }
        } catch (err) {
            console.error(err);
            showAlert({
                title: 'Error',
                description: 'Failed to rename person',
                variant: 'danger'
            });
        }
    };

    const openRenameModal = () => {
        if (selectedFaces.size === 0) return;
        setIsRenameModalOpen(true);
    };

    const handleUnassign = async () => {
        if (selectedFaces.size === 0) return;

        showConfirm({
            title: 'Remove Faces',
            description: `Remove ${selectedFaces.size} faces from ${person?.name}?`,
            confirmLabel: 'Remove Faces',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:unassignFaces', Array.from(selectedFaces));
                    setSelectedFaces(new Set());
                    loadData(); // Refresh
                } catch (err) {
                    console.error(err);
                    showAlert({
                        title: 'Error',
                        description: 'Failed to remove faces',
                        variant: 'danger'
                    });
                }
            }
        });
    };

    const handleTargetedScan = async (options: { folderPath?: string, onlyWithFaces?: boolean }) => {
        if (!person) return;
        setIsScanModalOpen(false);
        setIsScanning(true);
        try {
            // @ts-ignore
            const candidates = await window.ipcRenderer.invoke('db:getPhotosForTargetedScan', options);
            if (candidates && candidates.length > 0) {
                const photosToScan = candidates.map((p: any) => ({ ...p, scanMode: 'MACRO' }));
                addToQueue(photosToScan);
                showAlert({
                    title: 'Scan Started',
                    description: `${candidates.length} photos added to the AI queue.`
                });
            } else {
                showAlert({
                    title: 'No Photos Found',
                    description: 'No photos match the selected criteria for a targeted scan.'
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsScanning(false);
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
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        {person.name}
                        <button
                            onClick={() => setIsNameEditOpen(true)}
                            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                            title="Rename Person"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                        </button>
                    </h1>
                    <span className="text-gray-400 text-sm">({faces.length} faces)</span>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setIsBlurryModalOpen(true)}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Cleanup Blurry
                    </button>

                    <button
                        onClick={() => setIsScanModalOpen(true)}
                        disabled={isScanning}
                        className="bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
                        title="Scan all photos with high accuracy to find more of this person"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {isScanning ? 'Preparing...' : `Scan Library for ${person.name}`}
                    </button>

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
            </div>

            <BlurryFacesModal
                open={isBlurryModalOpen}
                onOpenChange={setIsBlurryModalOpen}
                personId={personId ? parseInt(personId) : null}
                onDeleteComplete={loadData}
            />

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

            <EditPersonNameModal
                isOpen={isNameEditOpen}
                onClose={() => setIsNameEditOpen(false)}
                currentName={person.name}
                onRename={handleRenamePerson}
            />

            <TargetedScanModal
                isOpen={isScanModalOpen}
                onClose={() => setIsScanModalOpen(false)}
                onStart={(options) => handleTargetedScan(options)}
                onSuccess={loadData}
                personName={person?.name}
                personId={person?.id}
            />
        </div >
    );
};

// Modal for Moving Faces (Renaming specific faces to another person)
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
            setAllPeopleNames(people.map((p: any) => p.name));
        } catch (err) {
            console.error('Failed to fetch people', err);
        }
    };

    useEffect(() => {
        if (name.length > 0) {
            const filtered = allPeopleNames
                .filter(p => p.toLowerCase().includes(name.toLowerCase()) && p !== name)
                .slice(0, 50);
            setSuggestions(filtered);
        } else {
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
                <p className="text-gray-400 mb-4 text-sm">Enter the name of the person to move these faces to.</p>

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

// Modal for Renaming the Person (Global Rename/Merge)
const EditPersonNameModal = ({
    isOpen,
    onClose,
    currentName,
    onRename
}: {
    isOpen: boolean,
    onClose: () => void,
    currentName: string,
    onRename: (newName: string) => void
}) => {
    const [name, setName] = useState(currentName);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
            // Force focus fix
            if (window.focus) window.focus();
        }
    }, [isOpen, currentName]);

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
                <h3 className="text-xl font-bold text-white mb-4">Rename Person</h3>

                <div className="mb-6">
                    <label className="block text-gray-400 text-sm mb-2">New Name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') onRename(name);
                            if (e.key === 'Escape') onClose();
                        }}
                    />
                    <p className="text-xs text-gray-500 mt-2">
                        Note: If this name belongs to another person, these two people will be <strong>merged</strong>. This cannot be undone.
                    </p>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onRename(name)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Rename
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PersonDetail;
