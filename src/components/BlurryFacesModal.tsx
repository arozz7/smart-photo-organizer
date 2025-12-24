import React, { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Slider from '@radix-ui/react-slider';
import { Cross2Icon, TrashIcon } from '@radix-ui/react-icons';
import { useAlert } from '../context/AlertContext';
import { Face } from '../types/index';
import { useAI } from '../context/AIContext';
import { usePeople } from '../context/PeopleContext';
import FaceThumbnail from './FaceThumbnail';
import { VirtuosoGrid } from 'react-virtuoso';

interface BlurryFacesModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    personId?: number | null; // Null for unnamed faces
    onDeleteComplete?: () => void;
}

interface BlurryFace extends Face {
    photo_id: number;
    blur_score: number;
    box: { x: number, y: number, width: number, height: number };
    person_name?: string;
    preview_cache_path?: string;
    original_width?: number;
}

const BlurryFacesModal: React.FC<BlurryFacesModalProps> = ({ open, onOpenChange, personId, onDeleteComplete }) => {
    const { calculateBlurScores, calculatingBlur, blurProgress } = useAI();
    const { people, autoNameFaces } = usePeople();
    // const { viewPhoto } = useScan(); // unused
    const { showAlert, showConfirm } = useAlert();
    const [threshold, setThreshold] = useState(25);
    const [faces, setFaces] = useState<BlurryFace[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [scope, setScope] = useState<'unnamed' | 'all' | 'person'>(personId ? 'person' : 'unnamed');
    const [debugStats, setDebugStats] = useState<any>(null);
    const [assignName, setAssignName] = useState('');
    const [previewPhoto, setPreviewPhoto] = useState<BlurryFace | null>(null);

    const loadFaces = useCallback(async () => {
        setLoading(true);
        try {
            // @ts-ignore
            const results = await window.ipcRenderer.invoke('face:getBlurry', { personId, threshold, scope });
            // Filter out faces with absolutely no image source
            const validFaces = (results || []).filter((f: any) => f.file_path || f.preview_cache_path);
            setFaces(validFaces);

            // Auto-select all by default
            setSelectedIds(new Set(validFaces.map((f: any) => f.id)));

            // Check debug stats
            // @ts-ignore
            const statsRes = await window.ipcRenderer.invoke('debug:getBlurStats');
            if (statsRes.success) setDebugStats(statsRes.stats);
        } catch (e) {
            console.error("Failed to load blurry faces:", e);
        } finally {
            setLoading(false);
        }
    }, [personId, threshold, scope]);

    // Load initial global setting ONLY when opening
    useEffect(() => {
        if (open) {
            console.log("[BlurryModal] Opened. Fetching settings...");
            // @ts-ignore
            window.ipcRenderer.invoke('ai:getSettings').then((s: any) => {
                if (s && s.faceBlurThreshold) {
                    console.log("[BlurryModal] Setting initial threshold from settings:", s.faceBlurThreshold + 5);
                    setThreshold(s.faceBlurThreshold + 5);
                }
            });
            loadFaces();
        }
    }, [open]);

    // Reload when threshold/scope changes (debounced)
    useEffect(() => {
        if (!open) return;

        console.log("[BlurryModal] Threshold/Scope changed. Queuing reload...", { threshold, scope });
        const timer = setTimeout(() => {
            console.log("[BlurryModal] loading faces now...");
            loadFaces();
        }, 500);
        return () => clearTimeout(timer);
    }, [threshold, scope, loadFaces]);

    // Reload faces when calculation finishes
    useEffect(() => {
        if (!calculatingBlur && open) {
            loadFaces();
        }
    }, [calculatingBlur, open, loadFaces]);

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
                    // Use ignoreFaces (soft delete) so they don't reappear on next scan
                    await window.ipcRenderer.invoke('db:ignoreFaces', Array.from(selectedIds));
                    setFaces(prev => prev.filter(f => !selectedIds.has(f.id)));
                    setSelectedIds(new Set());
                    if (onDeleteComplete) onDeleteComplete();
                } catch (e) {
                    console.error("Failed to delete faces:", e);
                    showAlert({
                        title: 'Error',
                        description: 'Failed to delete faces',
                        variant: 'danger'
                    });
                } finally {
                    setLoading(false);
                }
            }
        });
    };

    const handleAssign = async () => {
        if (selectedIds.size === 0 || !assignName.trim()) return;

        setLoading(true);
        try {
            await autoNameFaces(Array.from(selectedIds), assignName);

            // Remove from local list
            setFaces(prev => prev.filter(f => !selectedIds.has(f.id)));
            setSelectedIds(new Set());
            setAssignName('');

            if (onDeleteComplete) onDeleteComplete(); // Refresh parent view
            showAlert({
                title: 'Assigned',
                description: 'Faces assigned successfully.',
                variant: 'primary' // 'success' is not a valid variant
            });

        } catch (e) {
            console.error("Failed to assign faces:", e);
            showAlert({
                title: 'Error',
                description: 'Failed to assign faces',
                variant: 'danger'
            });
        } finally {
            setLoading(false);
        }
    }

    const itemContent = useCallback((index: number) => {
        const face = faces[index];
        if (!face) return null; // Safety check
        const isSelected = selectedIds.has(face.id);

        return (
            <div
                key={face.id}
                className={`relative group w-full h-full rounded-md overflow-hidden cursor-pointer border-2 transition-all ${isSelected ? 'border-red-500 opacity-100 ring-2 ring-red-500/50' : 'border-transparent opacity-80 hover:opacity-100'}`}
                onClick={() => handleToggleSelect(face.id)}
            >
                <FaceThumbnail
                    src={face.preview_cache_path
                        ? `local-resource://${encodeURIComponent(face.preview_cache_path)}?width=200&v=1`
                        : `local-resource://${encodeURIComponent(face.file_path || '')}?box=${face.box.x},${face.box.y},${face.box.width},${face.box.height}&width=200&v=1`
                    }
                    fallbackSrc={`local-resource://${encodeURIComponent(face.file_path || '')}?box=${face.box.x},${face.box.y},${face.box.width},${face.box.height}&width=200&v=1`}
                    // box={face.box} // Omit box to disable client-side processing
                    className="w-full h-full object-cover"
                />

                <div className="absolute top-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-bl backdrop-blur-sm">
                    {face.blur_score?.toFixed(1)}
                </div>

                {face.person_name && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] px-1 py-0.5 truncate text-center backdrop-blur-sm">
                        {face.person_name}
                    </div>
                )}

                {/* View Original Button */}
                {!isSelected && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            // onOpenChange(false); // No longer closing modal
                            // viewPhoto(face.photo_id); // No longer navigating
                            setPreviewPhoto(face);
                        }}
                        className="absolute bottom-1 right-1 bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all z-10"
                        title="View Original Photo"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}

                {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/30 backdrop-blur-[1px]">
                        <TrashIcon className="w-8 h-8 text-white drop-shadow-md" />
                    </div>
                )}
            </div>
        );
    }, [faces, selectedIds]);

    // Clear preview when modal closes
    useEffect(() => {
        if (!open) {
            setPreviewPhoto(null);
        }
    }, [open]);

    return (
        <>
            <Dialog.Root open={open} onOpenChange={onOpenChange}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
                    <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-7xl h-[90vh] bg-gray-900 border border-gray-700 p-6 rounded-lg shadow-xl z-50 flex flex-col">
                        <div className="flex flex-col gap-4 mb-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <Dialog.Title className="text-xl font-bold text-white">Clean Up Blurry Faces</Dialog.Title>
                                    <Dialog.Description asChild>
                                        <div className="text-sm text-gray-400 mt-1">
                                            Found {faces.length} faces below blur score {threshold}.
                                            {personId && <span className="block text-indigo-400 mt-1">Filtering for current person</span>}
                                            {debugStats && (
                                                <div className="mt-2 text-xs font-mono text-gray-500">
                                                    <div>[Debug] Scored: {debugStats.scored_count}/{debugStats.total} ({debugStats.null_count} pending)</div>
                                                    {debugStats.min_score !== null && <div>Range: {debugStats.min_score?.toFixed(1)} - {debugStats.max_score?.toFixed(1)}</div>}

                                                    {debugStats.null_count > 0 && !calculatingBlur && (
                                                        <button
                                                            onClick={() => calculateBlurScores()}
                                                            className="mt-2 text-blue-400 hover:text-blue-300 underline cursor-pointer"
                                                        >
                                                            Calculate scores for {debugStats.null_count} faces...
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {calculatingBlur && (
                                                <div className="mt-2 text-xs text-blue-400">
                                                    Scanning photo {blurProgress.current} of {blurProgress.total}...
                                                </div>
                                            )}
                                        </div>
                                    </Dialog.Description>
                                </div>

                                {!personId && (
                                    <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                                        <button
                                            onClick={() => setScope('unnamed')}
                                            className={`px-3 py-1 rounded text-xs font-medium transition-all ${scope === 'unnamed' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Unnamed Only
                                        </button>
                                        <button
                                            onClick={() => setScope('all')}
                                            className={`px-3 py-1 rounded text-xs font-medium transition-all ${scope === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            All Faces
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
                                <span className="text-sm text-gray-300">Blur Threshold: <span className="text-blue-400 text-xs font-mono">{threshold}</span></span>
                                <Slider.Root
                                    className="relative flex items-center select-none touch-none w-64 h-5"
                                    value={[threshold]}
                                    max={500}
                                    step={5}
                                    onValueChange={(v) => setThreshold(v[0])}
                                >
                                    <Slider.Track className="bg-gray-600 relative grow rounded-full h-[3px]">
                                        <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                                    </Slider.Track>
                                    <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow hover:bg-blue-50 focus:outline-none" />
                                </Slider.Root>
                            </div>
                        </div>

                        {/* Toolbar */}
                        <div className="flex justify-between items-center mb-2 px-1">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="select-all-blurry"
                                    checked={faces.length > 0 && selectedIds.size === faces.length}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedIds(new Set(faces.map(f => f.id)));
                                        } else {
                                            setSelectedIds(new Set());
                                        }
                                    }}
                                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                                <label htmlFor="select-all-blurry" className="text-sm text-gray-400 cursor-pointer select-none hover:text-gray-300">
                                    Select All
                                </label>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 bg-gray-950/50 rounded-lg p-4 border border-gray-800">
                            {loading && faces.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-gray-500">Scanning...</div>
                            ) : faces.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-gray-500">No faces found below this threshold.</div>
                            ) : (
                                <VirtuosoGrid
                                    style={{ height: '100%', width: '100%' }}
                                    totalCount={faces.length}
                                    overscan={0}
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
                                        )
                                    }}
                                    itemContent={itemContent}
                                />
                            )}
                        </div>

                        <div className="mt-4 flex justify-between items-center border-t border-gray-700 pt-4">
                            <div className="flex flex-col">
                                <span className="text-sm text-gray-300">
                                    {selectedIds.size} faces selected for discard
                                </span>
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded-full bg-gray-700 border border-gray-600 text-center leading-3 text-[8px]">i</span>
                                    This only removes the face detection. Original photos are NOT deleted.
                                </span>
                            </div>
                            <div className="flex gap-3 items-center">
                                {selectedIds.size > 0 && (
                                    <div className="flex gap-2 items-center bg-gray-800 p-1 pr-2 rounded mr-4">
                                        <input
                                            type="text"
                                            list="people-suggestions-blurry"
                                            placeholder="Assign to..."
                                            value={assignName}
                                            onChange={(e) => setAssignName(e.target.value)}
                                            className="bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:border-indigo-500 outline-none w-40"
                                        />
                                        <datalist id="people-suggestions-blurry">
                                            {people.map((p: any) => (
                                                <option key={p.id} value={p.name} />
                                            ))}
                                        </datalist>
                                        <button
                                            onClick={handleAssign}
                                            disabled={!assignName.trim()}
                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded transition-colors"
                                        >
                                            Assign
                                        </button>
                                    </div>
                                )}
                                <button
                                    onClick={() => onOpenChange(false)}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors text-white"
                                >
                                    Close
                                </button>
                                <button
                                    disabled={selectedIds.size === 0}
                                    onClick={handleDelete}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors text-white flex items-center gap-2 shadow-lg shadow-red-900/20"
                                >
                                    <TrashIcon />
                                    Discard Faces
                                </button>
                            </div>
                        </div>

                        <Dialog.Close asChild>
                            <button className="absolute top-4 right-4 text-gray-400 hover:text-white">
                                <Cross2Icon />
                            </button>
                        </Dialog.Close>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* Nested Preview Dialog */}
            <Dialog.Root open={!!previewPhoto} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60]" />
                    <Dialog.Content
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-auto h-auto max-w-[90vw] max-h-[90vh] p-0 rounded-lg shadow-2xl z-[70] focus:outline-none"
                        onPointerDownOutside={() => {
                            // Ensure clicks outside close the dialog
                            setPreviewPhoto(null);
                        }}
                    >
                        <div className="relative bg-black rounded-lg overflow-hidden border border-gray-700">
                            <button
                                onClick={() => setPreviewPhoto(null)}
                                className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full hover:bg-red-600 transition-colors z-20 cursor-pointer"
                            >
                                <Cross2Icon />
                            </button>
                            <img
                                src={`local-resource://${encodeURIComponent(previewPhoto?.file_path || '')}`}
                                alt="Original"
                                className="max-w-[90vw] max-h-[85vh] object-contain block"
                            />
                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/60 text-white text-xs truncate">
                                {previewPhoto?.file_path}
                            </div>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
};

export default BlurryFacesModal;
