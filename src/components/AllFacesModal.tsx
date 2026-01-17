import React, { useState, useEffect, useCallback, useMemo } from 'react';

import { VirtuosoGrid } from 'react-virtuoso';
import PersonFaceItem from './PersonFaceItem';
import { Face } from '../types';
import { useAlert } from '../context/AlertContext';
import { useToast } from '../context/ToastContext';


import RenameModal from './modals/RenameModal';

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
    const { addToast } = useToast();
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    // Snapshot for stable modal props
    const [facesToMove, setFacesToMove] = useState<number[]>([]);
    const [isScrolling, setIsScrolling] = useState(false);

    // Era Filtering
    const [eras, setEras] = useState<any[]>([]);
    const [selectedEra, setSelectedEra] = useState<number | 'all'>('all'); // 'all' or eraId
    // Unconfirmed Filter
    const [showUnconfirmedOnly, setShowUnconfirmedOnly] = useState(false);

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
        let result = faces;
        if (selectedEra !== 'all') {
            result = result.filter(f => f.era_id === selectedEra);
        }
        if (showUnconfirmedOnly) {
            result = result.filter(f => !f.is_confirmed);
        }
        return result;
    }, [faces, selectedEra, showUnconfirmedOnly]);

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

    const handleIgnore = async () => {
        if (selectedFaces.size === 0) return;

        showConfirm({
            title: 'Ignore Faces',
            description: `Ignore ${selectedFaces.size} faces from ${personName}? They will be removed and marked as ignored.`,
            confirmLabel: 'Ignore Faces',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:ignoreFaces', Array.from(selectedFaces));
                    addToast({ type: 'success', description: `Ignored ${selectedFaces.size} faces.` });
                    setSelectedFaces(new Set());
                    loadAllFaces(); // Refresh local list
                    onUpdate(); // Signal parent to refresh (though parent might not show all these faces)
                } catch (err) {
                    console.error(err);
                    showAlert({ title: 'Error', description: 'Failed to ignore faces', variant: 'danger' });
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
                personName: targetName,
                confirm: true // Mark as confirmed when manually moving
            });

            if (result.success) {
                setSelectedFaces(new Set());
                setIsMoveModalOpen(false);
                loadAllFaces();
                onUpdate();
                addToast({ type: 'success', description: `Moved ${selectedFaces.size} faces to ${targetName}.` });
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
                className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 min-[2000px]:grid-cols-14 gap-2 p-2"
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
                        {/* Unconfirmed filter toggle */}
                        <button
                            onClick={() => setShowUnconfirmedOnly(!showUnconfirmedOnly)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${showUnconfirmedOnly
                                ? 'text-amber-300 bg-amber-900/30 border-amber-500/50 hover:bg-amber-900/50'
                                : 'text-gray-400 bg-gray-700/50 border-gray-600 hover:bg-gray-700'
                                }`}
                        >
                            {showUnconfirmedOnly ? '✓ Unconfirmed Only' : 'Show Unconfirmed Only'}
                        </button>
                        <span className="text-gray-500 text-sm">({filteredFaces.length} showing)</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Selection Controls */}
                        <button
                            onClick={() => setSelectedFaces(new Set(filteredFaces.map(f => f.id)))}
                            className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                            title="Select all visible faces"
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
                <div className="flex-1 overflow-hidden bg-gray-950 relative">
                    <VirtuosoGrid
                        style={{ height: '100%' }}
                        totalCount={filteredFaces.length}
                        overscan={100}
                        isScrolling={setIsScrolling}
                        components={gridComponents}
                        itemContent={(index) => {
                            const face = filteredFaces[index];
                            return (
                                <div className="h-full">
                                    <PersonFaceItem
                                        face={face}
                                        isSelected={selectedFaces.has(face.id)}
                                        toggleSelection={toggleSelection}
                                        isScrolling={isScrolling}
                                    />
                                </div>
                            );
                        }}
                    />

                    {loading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                            <div className="bg-gray-900/80 p-4 rounded-full shadow-xl border border-indigo-500/30">
                                <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500/30 border-t-indigo-500" />
                            </div>
                        </div>
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
                                onUpdate(); // Refresh parent to update unconfirmed_count
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
                            onClick={() => {
                                setFacesToMove(Array.from(selectedFaces));
                                setIsMoveModalOpen(true);
                            }}
                            className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            Move
                        </button>
                        <button
                            onClick={handleIgnore}
                            className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            Ignore
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

            <RenameModal
                isOpen={isMoveModalOpen}
                onClose={() => setIsMoveModalOpen(false)}
                onConfirm={handleMove}
                initialValue=""
                count={facesToMove.length}
                faceIds={facesToMove}
                showSuggestions={false}
            />
        </div>
    );
}


