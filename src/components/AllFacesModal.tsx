import React, { useState, useEffect, useCallback, useMemo } from 'react';

import { VirtuosoGrid } from 'react-virtuoso';
import PersonFaceItem from './PersonFaceItem';
import { Face } from '../types';
import { useAlert } from '../context/AlertContext';
import { usePeople } from '../context/PeopleContext';
import { PersonNameInput } from './PersonNameInput';

interface AllFacesModalProps {
    isOpen: boolean;
    onClose: () => void;
    personId: number;
    personName: string;
    onUpdate: () => void; // Callback to refresh parent if needed
}

export default function AllFacesModal({ isOpen, onClose, personId, personName, onUpdate }: AllFacesModalProps) {
    const [faces, setFaces] = useState<Face[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFaces, setSelectedFaces] = useState<Set<number>>(new Set());
    const { showAlert, showConfirm } = useAlert();
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);

    // Era Filtering
    const [eras, setEras] = useState<any[]>([]);
    const [selectedEra, setSelectedEra] = useState<number | 'all'>('all'); // 'all' or eraId

    useEffect(() => {
        if (isOpen && personId) {
            loadAllFaces();
        } else {
            setFaces([]);
            setSelectedFaces(new Set());
        }
    }, [isOpen, personId]);

    const loadAllFaces = async () => {
        setLoading(true);
        try {
            // Fetch ALL faces (limit 10,000 to be safe, but practically all)
            // @ts-ignore
            const allFaces = await window.ipcRenderer.invoke('db:getAllFaces', {
                limit: 10000,
                filter: { personId },
                includeDescriptors: false
            });
            setFaces(allFaces);

            // Load Eras
            // @ts-ignore
            const loadedEras = await window.ipcRenderer.invoke('db:getEras', personId);
            setEras(loadedEras);
        } catch (err) {
            console.error(err);
            showAlert({ title: 'Error', description: 'Failed to load faces', variant: 'danger' });
        } finally {
            setLoading(false);
        }
    };

    const filteredFaces = useMemo(() => {
        if (selectedEra === 'all') return faces;
        return faces.filter(f => f.era_id === selectedEra);
    }, [faces, selectedEra]);

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

    const handleUnassign = async () => {
        if (selectedFaces.size === 0) return;

        showConfirm({
            title: 'Remove Faces',
            description: `Remove ${selectedFaces.size} faces from ${personName}? They will be returned to 'Unnamed Faces'.`,
            confirmLabel: 'Remove Faces',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:unassignFaces', Array.from(selectedFaces));
                    setSelectedFaces(new Set());
                    loadAllFaces(); // Refresh local list
                    onUpdate(); // Signal parent to refresh (though parent might not show all these faces)
                } catch (err) {
                    console.error(err);
                    showAlert({ title: 'Error', description: 'Failed to remove faces', variant: 'danger' });
                }
            }
        });
    };

    const handleMove = async (targetName: string) => {
        if (!targetName) return;
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: Array.from(selectedFaces),
                personName: targetName
            });

            if (result.success) {
                setSelectedFaces(new Set());
                setIsMoveModalOpen(false);
                loadAllFaces();
                onUpdate();
                showAlert({ title: 'Success', description: `Moved ${selectedFaces.size} faces to ${targetName}.` });
            } else {
                showAlert({ title: 'Move Failed', description: result.error, variant: 'danger' });
            }
        } catch (err) {
            console.error(err);
            showAlert({ title: 'Error', description: 'Failed to move faces', variant: 'danger' });
        }
    };

    const gridComponents = useMemo(() => ({
        List: React.forwardRef(({ children, style, ...props }: any, ref: any) => (
            <div
                ref={ref}
                {...props}
                style={style}
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4"
            >
                {children}
            </div>
        ))
    }), []) as any;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 w-full h-full max-w-7xl max-h-[90vh] rounded-xl border border-gray-800 shadow-2xl flex flex-col overflow-hidden m-4">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-800 bg-gray-900 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold text-white">Review All Faces: <span className="text-indigo-400">{personName}</span></h2>

                        {eras.length > 0 && (
                            <select
                                value={selectedEra}
                                onChange={(e) => setSelectedEra(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:outline-none focus:border-blue-500"
                            >
                                <option value="all">Show All Eras ({faces.length})</option>
                                {eras.map((era: any) => (
                                    <option key={era.id} value={era.id}>
                                        {era.era_name} ({era.face_count})
                                    </option>
                                ))}
                            </select>
                        )}
                        <span className="text-gray-500 text-sm">({filteredFaces.length} showing)</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Selection Controls */}
                        <button
                            onClick={() => setSelectedFaces(new Set(faces.map(f => f.id)))}
                            className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                            title="Select all faces"
                        >
                            Select All
                        </button>
                        {selectedFaces.size > 0 && (
                            <button
                                onClick={() => setSelectedFaces(new Set())}
                                className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                                title="Clear selection"
                            >
                                Clear ({selectedFaces.size})
                            </button>
                        )}
                        <div className="h-6 w-px bg-gray-700" />
                        <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden bg-gray-950">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                        </div>
                    ) : (
                        <VirtuosoGrid
                            style={{ height: '100%' }}
                            totalCount={filteredFaces.length}
                            components={gridComponents}
                            itemContent={(index) => {
                                const face = filteredFaces[index];
                                return (
                                    <div className="h-full">
                                        <PersonFaceItem
                                            face={face}
                                            isSelected={selectedFaces.has(face.id)}
                                            toggleSelection={toggleSelection}
                                        />
                                    </div>
                                );
                            }}
                        />
                    )}
                </div>

                {/* Floating Selection Action Bar */}
                {selectedFaces.size > 0 && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
                        <div className="text-sm font-medium text-white border-r border-gray-700 pr-4">
                            {selectedFaces.size} selected
                        </div>
                        <button
                            onClick={async () => {
                                // @ts-ignore
                                await window.ipcRenderer.invoke('db:confirmFaces', Array.from(selectedFaces));
                                setSelectedFaces(new Set());
                                loadAllFaces();
                            }}
                            className="text-sm font-medium text-green-400 hover:text-green-300 transition-colors flex items-center gap-2"
                            title="Mark as correctly assigned"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Confirm
                        </button>
                        <button
                            onClick={() => setIsMoveModalOpen(true)}
                            className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            Move
                        </button>
                        <button
                            onClick={handleUnassign}
                            className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Remove
                        </button>
                        <div className="border-l border-gray-700 pl-4">
                            <button
                                onClick={() => setSelectedFaces(new Set())}
                                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <MoveFacesModal
                isOpen={isMoveModalOpen}
                onClose={() => setIsMoveModalOpen(false)}
                onConfirm={handleMove}
                faceIds={Array.from(selectedFaces)}
            />
        </div>
    );
}

// Internal Move Modal
const MoveFacesModal = ({ isOpen, onClose, onConfirm, faceIds }: { isOpen: boolean, onClose: () => void, onConfirm: (name: string) => void, faceIds: number[] }) => {
    const [name, setName] = useState('');
    const [descriptors, setDescriptors] = useState<number[][] | undefined>(undefined);
    const { fetchFacesByIds } = usePeople();

    useEffect(() => {
        if (isOpen && faceIds.length > 0) {
            setName('');
            setDescriptors(undefined);

            // Fetch descriptors for AI suggestions (limit to 5)
            fetchFacesByIds(faceIds.slice(0, 5)).then(faces => {
                const descs = faces.map(f => f.descriptor).filter(d => !!d) as number[][];
                if (descs.length > 0) {
                    setDescriptors(descs);
                }
            });
        }
    }, [isOpen, faceIds, fetchFacesByIds]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-800 p-6 rounded-xl shadow-2xl w-full max-w-md border border-gray-700">
                <h3 className="text-xl font-bold text-white mb-2">Move {faceIds.length} Faces</h3>
                <p className="text-gray-400 mb-4 text-sm">Select the target person.</p>
                <div className="relative mb-6">
                    <PersonNameInput
                        autoFocus
                        value={name}
                        onChange={setName}
                        onCommit={() => name.trim() && onConfirm(name)}
                        descriptors={descriptors}
                        placeholder="Person Name"
                        className="w-full"
                        onSelect={(_id, selectedName) => {
                            setName(selectedName);
                            // Optional: auto-commit on select? 
                            // Usually "Move" button is safer for bulk actions.
                        }}
                    />
                </div>
                <div className="flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-gray-700 text-gray-300">Cancel</button>
                    <button
                        onClick={() => name.trim() && onConfirm(name)}
                        disabled={!name.trim()}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Move
                    </button>
                </div>
            </div>
        </div>
    );
};
