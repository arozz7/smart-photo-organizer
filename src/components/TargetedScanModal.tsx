
import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useScan } from '../context/ScanContext';
import { useAlert } from '../context/AlertContext';

interface TargetedScanModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStart: (options: { folderPath?: string, onlyWithFaces?: boolean }) => void;
    onSuccess?: () => void;
    personName?: string;
    personId?: number;
}

const TargetedScanModal: React.FC<TargetedScanModalProps> = ({ isOpen, onClose, onStart, onSuccess, personName, personId }) => {
    const { availableFolders } = useScan();
    const { showAlert } = useAlert();
    const [mode, setMode] = useState<'quick' | 'deep'>('quick');
    const [scope, setScope] = useState<'all' | 'folder'>('all');
    const [selectedFolder, setSelectedFolder] = useState<string>('');
    const [onlyWithFaces, setOnlyWithFaces] = useState(true);
    const [count, setCount] = useState<number | null>(null);
    const [loadingCount, setLoadingCount] = useState(false);
    const [matchedFaceIds, setMatchedFaceIds] = useState<number[]>([]);
    const [matchedAssociations, setMatchedAssociations] = useState<{ personId: number, faceId: number }[]>([]);
    const [autoAssignThreshold, setAutoAssignThreshold] = useState(0.65);  // Default, loaded from settings

    // Load settings on open
    useEffect(() => {
        if (isOpen) {
            // @ts-ignore - Fetch AI settings for threshold
            window.ipcRenderer.invoke('ai:getSettings').then((settings: any) => {
                if (settings?.autoAssignThreshold) {
                    setAutoAssignThreshold(settings.autoAssignThreshold);
                }
            }).catch(() => { });
        }
    }, [isOpen]);

    // Initial configuration on open
    useEffect(() => {
        if (isOpen && availableFolders.length > 0 && !selectedFolder) {
            const root = availableFolders.find(f => f.folder === '' || f.folder === '.');
            setSelectedFolder(root ? root.folder : availableFolders[0].folder);
        }
    }, [isOpen, availableFolders]);

    // Update count when parameters change
    useEffect(() => {
        if (isOpen) {
            updateCount();
        }
    }, [isOpen, mode, scope, selectedFolder, onlyWithFaces, autoAssignThreshold]);

    const updateCount = async () => {
        setLoadingCount(true);
        try {
            if (mode === 'quick') {
                if (personId) {
                    // Single Person Mode
                    // @ts-ignore
                    const descriptor = await window.ipcRenderer.invoke('db:getPersonMeanDescriptor', personId);
                    if (!descriptor) {
                        setCount(0);
                        setMatchedFaceIds([]);
                        return;
                    }

                    // Use threshold from settings
                    const searchResult = await window.ipcRenderer.invoke('ai:command', {
                        type: 'search_index',
                        payload: { descriptor, k: 1000, threshold: autoAssignThreshold }
                    });

                    if (searchResult?.matches?.length > 0) {
                        // Filter by distance: only accept high-confidence matches
                        const validMatches = searchResult.matches.filter((m: any) =>
                            (m.distance !== undefined && m.distance < autoAssignThreshold)
                        );
                        const ids = validMatches.map((m: any) => m.id);

                        // @ts-ignore
                        const metadata = await window.ipcRenderer.invoke('db:getFaceMetadata', ids);

                        const unnamedMatches = metadata.filter((m: any) => {
                            const isUnnamed = m.person_id === null || m.person_id === undefined;
                            const inFolder = scope === 'folder' ? m.file_path.startsWith(selectedFolder) : true;
                            return isUnnamed && inFolder;
                        });

                        setCount(unnamedMatches.length);
                        setMatchedFaceIds(unnamedMatches.map((m: any) => m.id));
                    } else {
                        setCount(0);
                        setMatchedFaceIds([]);
                    }
                } else {
                    // Bulk Mode (All Named)
                    // @ts-ignore
                    const peopleWithDescs = await window.ipcRenderer.invoke('db:getPeopleWithDescriptors');
                    if (peopleWithDescs.length === 0) {
                        setCount(0);
                        setMatchedAssociations([]);
                        showAlert({
                            title: 'No Reference Models',
                            description: 'No person models found for quick scanning. This means your faces might not have been fully analyzed. Please try a "Deep (Photo Re-detect)" scan to build these models.',
                            variant: 'danger'
                        });
                        return;
                    }

                    // For each person, get their matches.
                    // We'll use a map to keep the best match (highest score) for each faceId.
                    const bestMatches = new Map<number, { personId: number, score: number }>();

                    for (const p of peopleWithDescs) {
                        // @ts-ignore
                        const searchResult = await window.ipcRenderer.invoke('ai:command', {
                            type: 'search_index',
                            payload: { descriptor: p.descriptor, k: 500, threshold: autoAssignThreshold }
                        });


                        if (searchResult?.matches) {
                            for (const match of searchResult.matches) {
                                // FAISS returns distance (L2), lower is better.
                                const distance = match.distance !== undefined ? match.distance : 100;

                                // STRICT: Only accept matches below threshold from settings
                                if (distance >= autoAssignThreshold) continue;

                                const score = 1 / (1 + distance);

                                const existing = bestMatches.get(match.id);
                                if (!existing || score > existing.score) {
                                    bestMatches.set(match.id, { personId: p.id, score: score });
                                }
                            }
                        }
                    }

                    if (bestMatches.size > 0) {
                        const allMatchedFaceIds = Array.from(bestMatches.keys());
                        // @ts-ignore
                        const metadata = await window.ipcRenderer.invoke('db:getFaceMetadata', allMatchedFaceIds);

                        const filteredAssociations: { personId: number, faceId: number }[] = [];
                        for (const m of metadata) {
                            const isUnnamed = m.person_id === null || m.person_id === undefined;
                            const inFolder = scope === 'folder' ? m.file_path.startsWith(selectedFolder) : true;
                            if (isUnnamed && inFolder) {
                                const best = bestMatches.get(m.id);
                                if (best) {
                                    filteredAssociations.push({ personId: best.personId, faceId: m.id });
                                }
                            }
                        }
                        setCount(filteredAssociations.length);
                        setMatchedAssociations(filteredAssociations);
                    } else {
                        setCount(0);
                        setMatchedAssociations([]);
                    }
                }
            } else {
                // Deep Scan
                // @ts-ignore
                const candidates = await window.ipcRenderer.invoke('db:getPhotosForTargetedScan', {
                    folderPath: scope === 'folder' ? selectedFolder : undefined,
                    onlyWithFaces
                });
                setCount(candidates.length);
            }
        } catch (e) {
            console.error("Failed to update count:", e);
            setCount(0);
        } finally {
            setLoadingCount(false);
        }
    };

    const handleStart = async () => {
        if (mode === 'quick') {
            if (personId) {
                if (matchedFaceIds.length > 0) {
                    // @ts-ignore
                    const res = await window.ipcRenderer.invoke('db:associateMatchedFaces', {
                        personId,
                        faceIds: matchedFaceIds
                    });
                    if (res.success) {
                        onSuccess?.();
                        onClose();
                        showAlert({
                            title: 'Success',
                            description: `Successfully associated ${matchedFaceIds.length} faces with ${personName || 'the selected person'}.`,
                            variant: 'primary'
                        });
                    }
                }
            } else if (matchedAssociations.length > 0) {
                // @ts-ignore
                const res = await window.ipcRenderer.invoke('db:associateBulkMatchedFaces', matchedAssociations);
                if (res.success) {
                    onSuccess?.();
                    onClose();
                    showAlert({
                        title: 'Association Complete',
                        description: `Linked ${matchedAssociations.length} unnamed faces to their respective people across your library.`,
                        variant: 'primary'
                    });
                }
            }
        } else {
            onStart({
                folderPath: scope === 'folder' ? selectedFolder : undefined,
                onlyWithFaces
            });
        }
    };

    if (!isOpen) return null;

    return (
        <Dialog.Root open={isOpen} onOpenChange={onClose}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-gray-900 border border-gray-800 p-0 rounded-xl shadow-2xl z-[101] overflow-hidden">

                    {/* Header */}
                    <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                        <Dialog.Title className="text-xl font-bold text-white">
                            Targeted Scan {personName ? `for ${personName}` : ''}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="text-gray-400 hover:text-white transition-colors">
                                <Cross2Icon className="w-5 h-5" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Scan Mode Selection */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Scan Strategy</label>
                            <div className="flex p-1 bg-gray-800 rounded-lg">
                                <button
                                    onClick={() => setMode('quick')}
                                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'quick' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Quick (Vector Match)
                                </button>
                                <button
                                    onClick={() => setMode('deep')}
                                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'deep' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Deep (Photo Re-detect)
                                </button>
                            </div>
                        </div>

                        <p className="text-gray-400 text-sm leading-relaxed">
                            {mode === 'quick' ? (
                                <>
                                    Quickly find matches by comparing existing face vectors. This is <strong>nearly instantaneous</strong> and doesn't require re-scanning your photos.
                                </>
                            ) : (
                                <>
                                    Scan photos with <strong>High Accuracy (MACRO)</strong> mode. This ensures the best recognition results but is slower than standard scans.
                                </>
                            )}
                        </p>

                        {/* Scope Selection */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Search Area</label>
                            <div className="flex p-1 bg-gray-800 rounded-lg">
                                <button
                                    onClick={() => setScope('all')}
                                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${scope === 'all' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Entire Library
                                </button>
                                <button
                                    onClick={() => setScope('folder')}
                                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${scope === 'folder' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Select Folder
                                </button>
                            </div>

                            {scope === 'folder' && (
                                <select
                                    value={selectedFolder}
                                    onChange={(e) => setSelectedFolder(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                                >
                                    {availableFolders.map((f: any, idx: number) => (
                                        <option key={f.folder || idx} value={f.folder}>
                                            {f.folder ? (f.folder.split(/[\\/]/).pop() || 'Root') : 'Root'} ({f.folder || 'Root'})
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Filter Toggle - Only for Deep Scan */}
                        {mode === 'deep' && (
                            <div className="flex items-center justify-between p-4 bg-gray-800/30 rounded-lg border border-gray-800">
                                <div>
                                    <label className="text-sm font-medium text-gray-200 block">Only with Faces</label>
                                    <p className="text-[11px] text-gray-500">Only scan photos where at least one face was already found.</p>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={onlyWithFaces}
                                    onChange={(e) => setOnlyWithFaces(e.target.checked)}
                                    className="w-5 h-5 rounded border-gray-700 bg-gray-900 text-indigo-600 focus:ring-indigo-500"
                                />
                            </div>
                        )}

                        {/* Count Display */}
                        <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-lg p-4 flex items-center justify-between">
                            <span className="text-sm text-indigo-300 font-medium">
                                {mode === 'quick' ? 'Unnamed faces found:' : 'Photos to scan:'}
                            </span>
                            {loadingCount ? (
                                <div className="h-4 w-12 bg-indigo-500/10 animate-pulse rounded" />
                            ) : (
                                <span className="text-lg font-bold text-indigo-400">{count ?? 0}</span>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 hover:bg-gray-800 rounded-lg text-sm text-gray-300 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleStart}
                            disabled={loadingCount || count === 0}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-bold text-white transition-all shadow-lg shadow-indigo-900/40"
                        >
                            {mode === 'quick' ? 'Associate Faces' : 'Start Scan'}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default TargetedScanModal;
