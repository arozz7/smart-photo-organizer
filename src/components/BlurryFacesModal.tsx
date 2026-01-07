import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import * as Slider from '@radix-ui/react-slider';
import { Cross2Icon, TrashIcon, MagnifyingGlassIcon, CheckIcon } from '@radix-ui/react-icons';
import { useAlert } from '../context/AlertContext';
import { BlurryFace, PotentialMatch } from '../types/index';
import { useAI } from '../context/AIContext';
import { usePeople } from '../context/PeopleContext';
import FaceThumbnail from './FaceThumbnail';
import { VirtuosoGrid, Virtuoso } from 'react-virtuoso';
import { MemoizedFaceItem } from './MemoizedFaceItem';

interface BlurryFacesModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    personId?: number | null; // Null for unnamed faces
    onDeleteComplete?: () => void;
}



const BlurryFacesModal: React.FC<BlurryFacesModalProps> = ({ open, onOpenChange, personId, onDeleteComplete }) => {
    const { calculateBlurScores, calculatingBlur } = useAI();
    const { people, autoNameFaces } = usePeople();
    const { showAlert, showConfirm } = useAlert();
    const [threshold, setThreshold] = useState(25);
    const [faces, setFaces] = useState<BlurryFace[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [scope, setScope] = useState<'unnamed' | 'all' | 'person'>(personId ? 'person' : 'unnamed');
    const [debugStats, setDebugStats] = useState<any>(null);
    const [assignName, setAssignName] = useState('');
    const [previewPhoto, setPreviewPhoto] = useState<BlurryFace | null>(null);

    // State to track if we touched data
    const [hasChanges, setHasChanges] = useState(false);

    // Pagination
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [totalCount, setTotalCount] = useState(0);
    const BATCH_SIZE = 1000;

    // Low Confidence Scan
    const [scanningMatches, setScanningMatches] = useState(false);
    const [potentialMatches, setPotentialMatches] = useState<PotentialMatch[]>([]);
    const [showMatchModal, setShowMatchModal] = useState(false);
    const [matchThreshold, setMatchThreshold] = useState(0.45);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) {
            if (hasChanges && onDeleteComplete) {
                onDeleteComplete();
            }
            // Reset for next time
            setHasChanges(false);
        }
        onOpenChange(newOpen);
    }

    const showToast = (message: string) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 3000);
    }

    const performAssign = async (ids: number[], name: string) => {
        setLoading(true);
        try {
            await autoNameFaces(ids, name);
            setFaces(prev => prev.filter(f => !ids.includes(f.id)));

            // Clean up selection
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });

            setAssignName('');
            setTotalCount(prev => prev - ids.length);
            setHasChanges(true);

            // Replacing alert with toast
            showToast(`Assigned ${ids.length} faces to ${name}`);
        } catch (e) {
            console.error("Failed to assign faces:", e);
            showAlert({ title: 'Error', description: 'Failed to assign faces', variant: 'danger' });
        } finally {
            setLoading(false);
        }
    }

    const performIgnore = async (ids: number[]) => {
        setLoading(true);
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFaces', ids);
            setFaces(prev => prev.filter(f => !ids.includes(f.id)));
            setTotalCount(prev => prev - ids.length);
            setHasChanges(true);

            showToast(`Ignored ${ids.length} faces`);
        } catch (e) {
            console.error("Failed to ignore faces:", e);
        } finally {
            setLoading(false);
        }
    }

    const loadFaces = useCallback(async (reset = false) => {
        if (loading) return; // Prevent double trigger
        setLoading(true);
        try {
            const currentOffset = reset ? 0 : offset;

            // @ts-ignore
            const result = await window.ipcRenderer.invoke('face:getBlurry', {
                personId,
                threshold,
                scope,
                limit: BATCH_SIZE,
                offset: currentOffset
            });

            const newFaces = (result.faces || []).filter((f: any) => f.file_path || f.preview_cache_path);

            if (reset) {
                setFaces(newFaces);
                setOffset(newFaces.length);
                setSelectedIds(new Set()); // Reset selection on filter change
            } else {
                setFaces(prev => [...prev, ...newFaces]);
                setOffset(prev => prev + newFaces.length);
            }

            setTotalCount(result.total || 0);
            setHasMore(newFaces.length === BATCH_SIZE);

            // Debug Stats update
            // @ts-ignore
            const statsRes = await window.ipcRenderer.invoke('debug:getBlurStats');
            if (statsRes.success) setDebugStats(statsRes.stats);
        } catch (e) {
            console.error("Failed to load blurry faces:", e);
        } finally {
            setLoading(false);
        }
    }, [personId, threshold, scope, offset, loading]);

    // Load initial global setting ONLY when opening
    useEffect(() => {
        if (open) {
            console.log("[BlurryModal] Opened. Fetching settings...");
            // @ts-ignore
            window.ipcRenderer.invoke('ai:getSettings').then((s: any) => {
                if (s && s.faceBlurThreshold) {
                    setThreshold(s.faceBlurThreshold + 5);
                }
            });
            loadFaces(true);
        }
    }, [open]);

    // Reload when threshold/scope changes (debounced)
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => {
            loadFaces(true);
        }, 500);
        return () => clearTimeout(timer);
    }, [threshold, scope]);

    // Auto-reload when calculation finishes
    const prevCalculatingRef = useRef(calculatingBlur);
    useEffect(() => {
        if (prevCalculatingRef.current && !calculatingBlur) {
            loadFaces(true);
        }
        prevCalculatingRef.current = calculatingBlur;
    }, [calculatingBlur]);

    const handleToggleSelect = useCallback((id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;

        showConfirm({
            title: 'Discard Blurry Faces',
            description: `Are you sure you want to discard ${selectedIds.size} blurry face(s)? They will be removed from recognition.`,
            confirmLabel: 'Discard',
            variant: 'danger',
            onConfirm: async () => {
                setLoading(true);
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:ignoreFaces', Array.from(selectedIds));
                    setFaces(prev => prev.filter(f => !selectedIds.has(f.id)));
                    setSelectedIds(new Set());
                    setTotalCount(prev => prev - selectedIds.size);
                    setHasChanges(true);
                } catch (e) {
                    console.error("Failed to delete faces:", e);
                    showAlert({ title: 'Error', description: 'Failed to delete faces', variant: 'danger' });
                } finally {
                    setLoading(false);
                }
            }
        });
    };

    const handleAssign = async () => {
        if (selectedIds.size === 0 || !assignName.trim()) return;
        performAssign(Array.from(selectedIds), assignName);
    }



    // --- Low Confidence Scan Logic ---
    const handleScanMatches = async () => {
        setScanningMatches(true);
        try {
            // Scan currently loaded faces OR selected faces
            const targetIds = selectedIds.size > 0 ? Array.from(selectedIds) : faces.map(f => f.id);

            // @ts-ignore
            const res = await window.ipcRenderer.invoke('face:findPotentialMatches', {
                faceIds: targetIds,
                threshold: matchThreshold
            });

            if (res.success && res.matches.length > 0) {
                setPotentialMatches(res.matches);
                setShowMatchModal(true);
            } else {
                showAlert({ title: 'No Matches', description: `No potential matches found at threshold ${matchThreshold}`, variant: 'primary' });
            }
        } catch (e) {
            console.error("Scan failed:", e);
        } finally {
            setScanningMatches(false);
        }
    };

    const confirmMatch = async (faceId: number, personName: string) => {
        await performAssign([faceId], personName);
        setPotentialMatches(prev => prev.filter(m => m.faceId !== faceId));
        if (potentialMatches.length <= 1) setShowMatchModal(false);
    };

    // --- Render Items ---

    const itemContent = useCallback((index: number, _: any, context: any) => {
        const { selectedIds, handleToggleSelect, faces, onPreview } = context;
        const face = faces[index];
        if (!face) return null;
        const isSelected = selectedIds.has(face.id);

        return (
            <MemoizedFaceItem
                face={face}
                isSelected={isSelected}
                onToggle={handleToggleSelect}
                onPreview={onPreview}
            />
        );
    }, []);

    return (
        <>
            <Dialog.Root open={open} onOpenChange={handleOpenChange}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
                    <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-7xl h-[90vh] bg-gray-900 border border-gray-700 p-6 rounded-lg shadow-xl z-50 flex flex-col">
                        <div className="flex flex-col gap-4 mb-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <Dialog.Title className="text-xl font-bold text-white">Clean Up Blurry Faces</Dialog.Title>
                                    <Dialog.Description asChild>
                                        <div className="text-sm text-gray-400 mt-1">
                                            Found {totalCount} faces below blur score {threshold}.
                                            {personId && <span className="block text-indigo-400 mt-1">Filtering for current person</span>}
                                            {debugStats && (
                                                <div className="mt-2 text-xs font-mono text-gray-500">
                                                    <div>[Debug] Scored: {debugStats.scored_count}/{debugStats.total} ({debugStats.null_count} pending)</div>
                                                    {debugStats.null_count > 0 && !calculatingBlur && (
                                                        <button onClick={() => calculateBlurScores()} className="mt-2 text-blue-400 hover:text-blue-300 underline cursor-pointer">
                                                            Calculate scores for {debugStats.null_count} faces...
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </Dialog.Description>
                                </div>

                                <div className="flex flex-col gap-2 items-end">
                                    {!personId && (
                                        <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                                            <button onClick={() => setScope('unnamed')} className={`px-3 py-1 rounded text-xs font-medium transition-all ${scope === 'unnamed' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>Unnamed Only</button>
                                            <button onClick={() => setScope('all')} className={`px-3 py-1 rounded text-xs font-medium transition-all ${scope === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>All Faces</button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
                                <span className="text-sm text-gray-300">Blur Threshold: <span className="text-blue-400 text-xs font-mono">{threshold}</span></span>
                                <Slider.Root className="relative flex items-center select-none touch-none w-64 h-5" value={[threshold]} max={500} step={5} onValueChange={(v) => setThreshold(v[0])}>
                                    <Slider.Track className="bg-gray-600 relative grow rounded-full h-[3px]">
                                        <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                                    </Slider.Track>
                                    <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow hover:bg-blue-50 focus:outline-none" />
                                </Slider.Root>

                                <div className="w-px h-6 bg-gray-600 mx-2" />

                                <span className="text-sm text-gray-300">Match Conf: <span className="text-green-400 text-xs font-mono">{matchThreshold}</span></span>
                                <Slider.Root className="relative flex items-center select-none touch-none w-32 h-5" value={[matchThreshold]} max={1} step={0.05} onValueChange={(v) => setMatchThreshold(v[0])}>
                                    <Slider.Track className="bg-gray-600 relative grow rounded-full h-[3px]">
                                        <Slider.Range className="absolute bg-green-500 rounded-full h-full" />
                                    </Slider.Track>
                                    <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow hover:bg-green-50 focus:outline-none" />
                                </Slider.Root>

                                <button
                                    onClick={handleScanMatches}
                                    disabled={scanningMatches || faces.length === 0}
                                    className="ml-auto text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-2"
                                >
                                    {scanningMatches ? <div className="animate-spin h-3 w-3 border-2 border-white rounded-full border-t-transparent" /> : <MagnifyingGlassIcon />}
                                    Identify Matches
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-between items-center mb-2 px-1">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="select-all-blurry"
                                    checked={faces.length > 0 && selectedIds.size === faces.length}
                                    onChange={(e) => {
                                        if (e.target.checked) setSelectedIds(new Set(faces.map(f => f.id)));
                                        else setSelectedIds(new Set());
                                    }}
                                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                                <label htmlFor="select-all-blurry" className="text-sm text-gray-400 cursor-pointer select-none hover:text-gray-300">
                                    Select All Loaded ({faces.length})
                                </label>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 bg-gray-950/50 rounded-lg p-4 border border-gray-800">
                            {faces.length === 0 && !loading ? (
                                <div className="flex items-center justify-center h-full text-gray-500">No faces found below this threshold.</div>
                            ) : (
                                <VirtuosoGrid
                                    style={{ height: '100%', width: '100%' }}
                                    totalCount={faces.length}
                                    overscan={50}
                                    context={{ selectedIds, handleToggleSelect, faces, onPreview: setPreviewPhoto }}
                                    endReached={() => {
                                        if (hasMore) loadFaces(false);
                                    }}
                                    components={{
                                        List: React.forwardRef(({ style, children, ...props }: any, ref) => (
                                            <div
                                                ref={ref}
                                                {...props}
                                                style={{ ...style, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '1rem', alignContent: 'start' }}
                                                className="pb-4 pr-2"
                                            >
                                                {children}
                                            </div>
                                        )),
                                        Item: ({ children, ...props }: any) => (
                                            <div {...props} className="aspect-square w-full">
                                                {children}
                                            </div>
                                        ),
                                        Footer: () => (
                                            loading ? (
                                                <div className="col-span-full py-4 flex justify-center text-gray-500">
                                                    Loading more...
                                                </div>
                                            ) : null
                                        )
                                    }}
                                    itemContent={itemContent}
                                />
                            )}
                        </div>

                        <div className="mt-4 flex justify-between items-center border-t border-gray-700 pt-4">
                            <div className="flex flex-col">
                                <span className="text-sm text-gray-300">
                                    {selectedIds.size} faces selected
                                </span>
                                <span className="text-xs text-gray-500">This only removes the face detection.</span>
                            </div>
                            <button onClick={() => onOpenChange(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors text-white">Close</button>
                        </div>

                        {/* Floating Selection Action Bar */}
                        {selectedIds.size > 0 && (
                            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
                                <div className="text-sm font-medium text-white border-r border-gray-700 pr-4">
                                    {selectedIds.size} selected
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        list="people-suggestions-blurry-fab"
                                        placeholder="Assign to..."
                                        value={assignName}
                                        onChange={(e) => setAssignName(e.target.value)}
                                        className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded-full border border-gray-600 focus:border-indigo-500 outline-none w-32"
                                    />
                                    <datalist id="people-suggestions-blurry-fab">
                                        {people.map((p: any) => <option key={p.id} value={p.name} />)}
                                    </datalist>
                                    <button
                                        onClick={handleAssign}
                                        disabled={!assignName.trim()}
                                        className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                        Assign
                                    </button>
                                </div>
                                <button
                                    onClick={handleDelete}
                                    className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Discard
                                </button>
                                <div className="border-l border-gray-700 pl-4">
                                    <button
                                        onClick={() => setSelectedIds(new Set())}
                                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        <Dialog.Close asChild>
                            <button className="absolute top-4 right-4 text-gray-400 hover:text-white"><Cross2Icon /></button>
                        </Dialog.Close>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* Match Results Modal */}
            <Dialog.Root open={showMatchModal} onOpenChange={setShowMatchModal}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60]" />
                    <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[85vh] bg-gray-900 border border-gray-700 p-6 rounded-lg shadow-xl z-[70] flex flex-col">
                        <Dialog.Title className="text-lg font-bold text-white mb-4">Potential Matches ({potentialMatches.length})</Dialog.Title>

                        <div className="flex-1 min-h-0 bg-gray-950/30 rounded border border-white/5">
                            <Virtuoso
                                style={{ height: '100%' }}
                                data={useMemo(() => {
                                    return Object.entries(potentialMatches.reduce((acc, match) => {
                                        const key = match.match.personId;
                                        if (!acc[key]) acc[key] = { name: match.match.personName, items: [] };
                                        acc[key].items.push(match);
                                        return acc;
                                    }, {} as Record<number, { name: string, items: PotentialMatch[] }>))
                                        .map(([key, group]) => ({ id: Number(key), ...group }))
                                }, [potentialMatches])}
                                itemContent={(_, group) => (
                                    <div className="mb-4 mx-2">
                                        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                                            <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700">
                                                <div className="font-semibold text-white flex items-center gap-2">
                                                    {group.name}
                                                    <span className="text-gray-400 text-sm font-normal">({group.items.length})</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => {
                                                            const ids = group.items.map(i => i.faceId);
                                                            performAssign(ids, group.name);
                                                            setPotentialMatches(prev => prev.filter(pm => !ids.includes(pm.faceId)));
                                                            if (potentialMatches.length - ids.length <= 0) setShowMatchModal(false);
                                                        }}
                                                        className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                                                    >
                                                        <CheckIcon /> Confirm All
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const ids = group.items.map(i => i.faceId);
                                                            performIgnore(ids);
                                                            setPotentialMatches(prev => prev.filter(pm => !ids.includes(pm.faceId)));
                                                            if (potentialMatches.length - ids.length <= 0) setShowMatchModal(false);
                                                        }}
                                                        className="text-xs bg-red-900/50 hover:bg-red-800 text-red-200 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                                                    >
                                                        <TrashIcon /> Ignore All
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {group.items.slice(0, 50).map(pm => {
                                                    const face = faces.find(f => f.id === pm.faceId);
                                                    if (!face) return null;
                                                    return (
                                                        <div key={pm.faceId} className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700/50 hover:border-gray-600 transition-colors">
                                                            <div className="w-12 h-12 rounded overflow-hidden shrink-0">
                                                                <FaceThumbnail
                                                                    src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                                                    fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path || '')}`}
                                                                    box={face.box}
                                                                    originalImageWidth={face.original_width || 0}
                                                                    useServerCrop={true}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-gray-500 text-[10px] tabular-nums">
                                                                    Conf: {pm.match.similarity.toFixed(2)}
                                                                </div>
                                                                <div className="text-gray-600 text-[10px] truncate" title={face.file_path}>
                                                                    {face.file_path?.split(/[/\\]/).pop()}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => confirmMatch(pm.faceId, pm.match.personName)}
                                                                className="p-1.5 bg-green-600/20 hover:bg-green-600 text-green-400 hover:text-white rounded transition-colors"
                                                                title="Confirm Match"
                                                            >
                                                                <CheckIcon className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    )
                                                })}
                                                {group.items.length > 50 && (
                                                    <div className="col-span-full text-center py-2 text-xs text-gray-500">
                                                        + {group.items.length - 50} more items (Confirm All to process)
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            />
                        </div>
                        <div className="flex justify-end mt-4 pt-4 border-t border-gray-700">
                            <button onClick={() => setShowMatchModal(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors">Close</button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* Preview Modal */}
            <PreviewDialog
                face={previewPhoto}
                onClose={() => setPreviewPhoto(null)}
            />

            {/* Toast Notification */}
            <Toast open={!!toastMessage} message={toastMessage || ''} />
        </>
    );
};

// Separated component for Preview to manage image logic cleanly
const PreviewDialog = ({ face, onClose }: { face: BlurryFace | null, onClose: () => void }) => {
    const imgRef = useRef<HTMLImageElement>(null);
    const [imgRect, setImgRect] = useState<{ width: number, height: number, left: number, top: number } | null>(null);

    // Update rect on resize or load
    const updateRect = () => {
        if (imgRef.current) {
            const rect = imgRef.current.getBoundingClientRect();
            setImgRect({ width: rect.width, height: rect.height, left: rect.left, top: rect.top });
        }
    };

    useEffect(() => {
        if (face) {
            window.addEventListener('resize', updateRect);
            // reset
            setImgRect(null);
        }
        return () => window.removeEventListener('resize', updateRect);
    }, [face]);

    if (!face) return null;

    return (
        <Dialog.Root open={!!face} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/90 backdrop-blur z-[80]" />
                <Dialog.Content
                    className="fixed inset-0 z-[90] flex items-center justify-center outline-none"
                    onPointerDown={(e) => {
                        if (e.target === e.currentTarget) onClose();
                    }}
                >
                    <Dialog.Title className="sr-only">Original Photo Preview</Dialog.Title>
                    <Dialog.Description className="sr-only">Preview of the original photo containing the detected face.</Dialog.Description>

                    <div className="relative pointer-events-auto w-full h-full flex items-center justify-center p-4">
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors z-50 bg-black/20 rounded-full hover:bg-black/40"
                        >
                            <Cross2Icon className="w-8 h-8" />
                        </button>

                        <div className="relative max-w-full max-h-full">
                            {(() => {
                                const ext = face.file_path?.split('.').pop()?.toLowerCase() || '';
                                const isWebFriendly = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
                                const hasPreview = !!face.preview_cache_path;

                                if (!isWebFriendly && !hasPreview) {
                                    return (
                                        <div className="text-gray-400 flex flex-col items-center gap-2 p-10 bg-gray-800 rounded-lg border border-gray-700">
                                            <div className="text-4xl">⚠️</div>
                                            <span className="font-semibold">Preview Unavailable</span>
                                            <span className="text-xs text-gray-500 max-w-xs text-center">
                                                This is a RAW file without a generated preview. Run 'Scan Folder' to generate previews.
                                            </span>
                                        </div>
                                    );
                                }

                                const src = isWebFriendly
                                    ? `local-resource://${encodeURIComponent(face.file_path || '')}`
                                    : `local-resource://${encodeURIComponent(face.preview_cache_path || '')}`;

                                return (
                                    <img
                                        ref={imgRef}
                                        src={src}
                                        alt="Original"
                                        className="max-w-[95vw] max-h-[95vh] object-contain shadow-2xl"
                                        onLoad={updateRect}
                                    />
                                );
                            })()}

                            {/* Bounding Box Overlay */}
                            {imgRect && face.original_width && face.original_height && (
                                <div
                                    className="absolute border-2 border-green-500 shadow-[0_0_10px_rgba(0,255,0,0.5)]"
                                    style={{
                                        left: `${(face.box.x / face.original_width) * 100}%`,
                                        top: `${(face.box.y / face.original_height) * 100}%`,
                                        width: `${(face.box.width / face.original_width) * 100}%`,
                                        height: `${(face.box.height / face.original_height) * 100}%`
                                    }}
                                >
                                    <div className="absolute -top-6 left-0 bg-green-500 text-black text-xs font-bold px-1 rounded-sm shadow-sm whitespace-nowrap">
                                        Face
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/90 text-sm font-mono bg-black/70 px-4 py-2 rounded-full border border-white/10 shadow-lg text-center max-w-[90vw] truncate">
                            {face.file_path}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

const Toast = ({ open, message }: { open: boolean, message: string }) => {
    if (!open) return null;
    return createPortal(
        <div className="fixed bottom-10 right-10 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-2xl border border-gray-700 z-[100] animate-slide-in-right flex items-center gap-3">
            <CheckIcon className="w-5 h-5 text-green-500" />
            <span className="font-medium">{message}</span>
        </div>,
        document.body
    );
}

export default BlurryFacesModal;
