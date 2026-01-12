import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import FaceThumbnail from './FaceThumbnail';
import { useToast } from '../context/ToastContext';
import { useClusterController } from '../hooks/useClusterController';

interface RecoveredFacesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function RecoveredFacesModal({ isOpen, onClose }: RecoveredFacesModalProps) {
    const { addToast } = useToast();
    const [faces, setFaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Group faces by suggested person for the controller
    const clustersData = useMemo(() => {
        const groups: Record<string, { name: string, personId: number | null, faces: any[] }> = {};

        faces.forEach(face => {
            const key = face.suggested_person_id || 'unknown';
            if (!groups[key]) {
                groups[key] = {
                    name: face.suggested_name || 'Unknown',
                    personId: face.suggested_person_id,
                    faces: []
                };
            }
            groups[key].faces.push(face);
        });

        // Convert to array of clusters
        return Object.entries(groups).map(([key, group]) => ({
            faces: group.faces.map(f => f.id),
            data: { ...group, key }
        }));
    }, [faces]);

    const controller = useClusterController({
        clusters: clustersData,
        pageSize: 1000 // Show all effectively
    });

    const { selectedFaceIds } = controller;

    // Load recovered faces on mount/open
    useEffect(() => {
        if (isOpen) {
            loadFaces();
            controller.clearSelection();
        }
    }, [isOpen]);

    const loadFaces = async () => {
        setLoading(true);
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getRecoveredFaces');
            if (res.success) {
                setFaces(res.faces);
                // Select all by default for easy "Recover All"
                controller.selectAll(new Set(res.faces.map((f: any) => f.id)));
            } else {
                throw new Error(res.error);
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', description: 'Failed to load recovered faces.' });
        } finally {
            setLoading(false);
        }
    };

    const handleRecover = async () => {
        if (selectedFaceIds.size === 0) return;

        try {
            const ids = Array.from(selectedFaceIds);
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:recoverFaces', ids);
            if (res.success) {
                addToast({ type: 'success', description: `Recovered ${ids.length} faces. Check Suggestions/Discoveries tabs.` });
                onClose();
            } else {
                throw new Error(res.error);
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', description: 'Failed to recover faces.' });
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <span className="text-indigo-400">⚡</span> Recovered Background Matches
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                            These ignored faces were matched in the background. Recover them to accept the matches.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-8">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-4 text-gray-500">
                            <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
                            <p>Scanning ignored faces for matches...</p>
                        </div>
                    ) : faces.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <span className="text-4xl mb-4">✅</span>
                            <p>No new matches found among ignored faces.</p>
                            <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300">
                                Close
                            </button>
                        </div>
                    ) : (
                        controller.allClusters.map((cluster) => {
                            const groupData = cluster.data;
                            const facesInGroup = groupData.faces; // Original full face objects need to be retrieved via the data prop we passed

                            return (
                                <div key={groupData.key} className="bg-gray-800/20 rounded-xl border border-gray-800 overflow-hidden">
                                    {/* Group Header */}
                                    <div className="flex items-center justify-between px-4 py-3 bg-gray-900/40 border-b border-gray-800">
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="checkbox"
                                                checked={facesInGroup.every((f: any) => selectedFaceIds.has(f.id))}
                                                onChange={() => controller.toggleGroup(facesInGroup.map((f: any) => f.id))}
                                                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-200">{groupData.name}</span>
                                                <span className="text-xs text-gray-500">{facesInGroup.length} faces matched</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const ids = facesInGroup.map((f: any) => f.id);
                                                try {
                                                    // @ts-ignore
                                                    await window.ipcRenderer.invoke('db:recoverFaces', ids);
                                                    addToast({ type: 'success', description: `Recovered ${ids.length} faces for ${groupData.name}` });
                                                    // Remove from state
                                                    setFaces(prev => prev.filter(f => !ids.includes(f.id)));
                                                    controller.clearSelection(); // Simplest reset
                                                } catch (e) {
                                                    console.error(e);
                                                    addToast({ type: 'error', description: 'Failed to recover group.' });
                                                }
                                            }}
                                            className="text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 px-3 py-1.5 rounded-lg border border-indigo-500/30 transition-colors"
                                        >
                                            Recover Group
                                        </button>
                                    </div>

                                    {/* Faces Grid */}
                                    <div className="p-4 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                        {facesInGroup.map((face: any) => (
                                            <div
                                                key={face.id}
                                                onClick={() => controller.toggleFace(face.id)}
                                                className={`relative group cursor-pointer aspect-square rounded-lg overflow-hidden border-2 transition-all ${selectedFaceIds.has(face.id)
                                                    ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                                                    : 'border-transparent hover:border-gray-600'
                                                    }`}
                                            >
                                                <FaceThumbnail
                                                    src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                                    box={JSON.parse(face.box)}
                                                    originalImageWidth={face.width}
                                                    useServerCrop={true}
                                                    className={`w-full h-full object-cover transition-opacity ${selectedFaceIds.has(face.id) ? 'opacity-100' : 'opacity-90 group-hover:opacity-100'}`}
                                                />

                                                {selectedFaceIds.has(face.id) && (
                                                    <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                                        <div className="bg-indigo-500 rounded-full p-0.5">
                                                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                {faces.length > 0 && (
                    <div className="p-4 border-t border-gray-800 bg-gray-900/50 flex justify-between items-center backdrop-blur-xl">
                        <div className="text-sm text-gray-400">
                            <span className="text-white font-bold">{selectedFaceIds.size}</span> Selected
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRecover}
                                disabled={selectedFaceIds.size === 0}
                                className={`px-6 py-2 rounded-lg text-sm font-bold text-white transition-all transform active:scale-95 ${selectedFaceIds.size > 0
                                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-900/40'
                                    : 'bg-gray-800 cursor-not-allowed opacity-50'
                                    }`}
                            >
                                Recover {selectedFaceIds.size} Selected
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
