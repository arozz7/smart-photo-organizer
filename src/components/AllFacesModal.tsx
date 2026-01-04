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
        } catch (err) {
            console.error(err);
            showAlert({ title: 'Error', description: 'Failed to load faces', variant: 'danger' });
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
                        <span className="text-gray-500 text-sm">({faces.length} faces)</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {selectedFaces.size > 0 && (
                            <>
                                <button
                                    onClick={() => setIsMoveModalOpen(true)}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    Move ({selectedFaces.size})
                                </button>
                                <button
                                    onClick={handleUnassign}
                                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-500 border border-red-500/30 rounded-lg text-sm font-medium transition-colors"
                                >
                                    Remove ({selectedFaces.size})
                                </button>
                                <div className="h-6 w-px bg-gray-700 mx-2" />
                            </>
                        )}
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
                            totalCount={faces.length}
                            components={gridComponents}
                            itemContent={(index) => {
                                const face = faces[index];
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
