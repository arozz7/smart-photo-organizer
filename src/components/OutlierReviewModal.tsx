/**
 * OutlierReviewModal.tsx
 * 
 * Modal for reviewing potentially misassigned faces detected by the
 * distance-from-centroid analysis (Phase 1: Misassigned Face Detection).
 */

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import FaceThumbnail from './FaceThumbnail';
import RenameModal from './modals/RenameModal';
import { OutlierResult } from '../hooks/usePersonDetail';
import { useScan } from '../context/ScanContext';

interface OutlierReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    personName: string;
    outliers: OutlierResult[];
    onRemoveFaces: (faceIds: number[]) => Promise<void>;
    onMoveFaces: (faceIds: number[], targetName: string) => Promise<void>;
    onRefresh: () => void;
}

export default function OutlierReviewModal({
    isOpen,
    onClose,
    personName,
    outliers: initialOutliers,
    onRemoveFaces,
    onMoveFaces,
    onRefresh
}: OutlierReviewModalProps) {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isProcessing, setIsProcessing] = useState(false);
    const { viewPhoto, viewingPhoto } = useScan();
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    // Local copy of outliers so we can filter out removed faces without closing
    const [localOutliers, setLocalOutliers] = useState<OutlierResult[]>(initialOutliers);

    // Sync local outliers when prop changes (e.g., re-opening modal)
    useEffect(() => {
        setLocalOutliers(initialOutliers);
        setSelectedIds(new Set());
    }, [initialOutliers]);

    const toggleSelection = (faceId: number) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(faceId)) {
            newSet.delete(faceId);
        } else {
            newSet.add(faceId);
        }
        setSelectedIds(newSet);
    };

    const selectAll = () => {
        setSelectedIds(new Set(localOutliers.map(o => o.faceId)));
    };

    const deselectAll = () => {
        setSelectedIds(new Set());
    };

    const handleRemoveSelected = async () => {
        if (selectedIds.size === 0) return;

        setIsProcessing(true);
        try {
            await onRemoveFaces(Array.from(selectedIds));
            // Filter out removed faces from local state
            setLocalOutliers(prev => prev.filter(o => !selectedIds.has(o.faceId)));
            setSelectedIds(new Set());
            // Refresh parent data but don't close
            onRefresh();
        } catch (err) {
            console.error('Failed to remove faces:', err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleMoveSelected = async (targetName: string) => {
        if (selectedIds.size === 0) return;

        setIsProcessing(true);
        try {
            await onMoveFaces(Array.from(selectedIds), targetName);
            // Filter out moved faces from local state
            setLocalOutliers(prev => prev.filter(o => !selectedIds.has(o.faceId)));
            setSelectedIds(new Set());
            setIsRenameModalOpen(false);
            // Refresh parent data but don't close
            onRefresh();
        } catch (err) {
            console.error('Failed to move faces:', err);
        } finally {
            setIsProcessing(false);
        }
    };

    const getDistanceLabel = (distance: number): { label: string; color: string } => {
        if (distance > 1.0) return { label: 'Very Different', color: 'text-red-400' };
        if (distance > 0.8) return { label: 'Different', color: 'text-orange-400' };
        if (distance > 0.6) return { label: 'Suspicious', color: 'text-yellow-400' };
        return { label: 'Borderline', color: 'text-gray-400' };
    };

    return (
        <>
            <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
                    <Dialog.Content
                        onEscapeKeyDown={(e) => {
                            if (viewingPhoto) {
                                e.preventDefault();
                            }
                        }}
                        onPointerDownOutside={(e) => {
                            if (viewingPhoto) {
                                e.preventDefault();
                            }
                        }}
                        onInteractOutside={(e) => {
                            if (viewingPhoto) {
                                e.preventDefault();
                            }
                        }}
                        className="fixed inset-4 md:inset-10 lg:inset-20 bg-gray-900 rounded-xl border border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in"
                    >

                        {/* Header */}
                        <div className="flex-none p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur">
                            <div>
                                <Dialog.Title className="text-xl font-semibold text-white flex items-center gap-2">
                                    <span className="text-2xl">🔍</span>
                                    Potentially Misassigned Faces
                                </Dialog.Title>
                                <Dialog.Description className="text-sm text-gray-400 mt-1">
                                    These faces appear different from {personName}'s typical appearance
                                </Dialog.Description>
                            </div>
                            <button
                                onClick={onClose}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
                            >
                                Close
                            </button>
                        </div>

                        {/* Toolbar */}
                        <div className="flex-none p-3 bg-gray-800/30 border-b border-gray-800 flex items-center gap-4">
                            <div className="text-sm text-gray-400">
                                {localOutliers.length} potential outlier{localOutliers.length !== 1 ? 's' : ''} found
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={selectedIds.size === localOutliers.length ? deselectAll : selectAll}
                                    className="px-3 py-1.5 text-sm font-medium text-indigo-300 bg-indigo-900/20 hover:bg-indigo-900/40 border border-indigo-500/30 rounded-lg transition-colors"
                                >
                                    {selectedIds.size === localOutliers.length ? 'Deselect All' : 'Select All'}
                                </button>
                            </div>
                            <div className="flex-1" />
                            {selectedIds.size > 0 && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setIsRenameModalOpen(true)}
                                        disabled={isProcessing}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        Move / Rename ({selectedIds.size})
                                    </button>
                                    <button
                                        onClick={handleRemoveSelected}
                                        disabled={isProcessing}
                                        className="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-red-900/20 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {isProcessing && <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
                                        Remove ({selectedIds.size})
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {localOutliers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                    <span className="text-4xl mb-4">✓</span>
                                    <p>No potential misassignments found</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                    {localOutliers.map(outlier => {
                                        const distanceInfo = getDistanceLabel(outlier.distance);
                                        const isSelected = selectedIds.has(outlier.faceId);

                                        return (
                                            <div
                                                key={outlier.faceId}
                                                onClick={() => toggleSelection(outlier.faceId)}
                                                className={`relative cursor-pointer rounded-xl overflow-hidden transition-all group border-2 ${isSelected
                                                    ? 'border-red-500 ring-2 ring-red-500/30'
                                                    : 'border-transparent hover:border-gray-600'
                                                    }`}
                                            >
                                                {/* Face Thumbnail */}
                                                <div className="aspect-square bg-gray-800">
                                                    <FaceThumbnail
                                                        src={`local-resource://${encodeURIComponent(outlier.file_path || '')}`}
                                                        fallbackSrc={`local-resource://${encodeURIComponent(outlier.preview_cache_path || outlier.file_path || '')}`}
                                                        box={outlier.box}
                                                        originalImageWidth={outlier.photo_width}
                                                        useServerCrop={true}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>

                                                {/* Distance Badge */}
                                                <div className="absolute top-2 right-2 bg-black/70 backdrop-blur px-2 py-1 rounded text-xs font-mono z-10">
                                                    <span className={distanceInfo.color}>
                                                        {(outlier.distance * 100).toFixed(0)}% diff
                                                    </span>
                                                </div>

                                                {/* Preview Button (Hover) */}
                                                <div className="absolute bottom-8 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all z-20">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            viewPhoto(outlier.photo_id);
                                                        }}
                                                        className="bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm transform hover:scale-110 transition-transform"
                                                        title="View Original Photo"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                </div>

                                                {/* Selection Indicator */}
                                                {isSelected && (
                                                    <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-400 drop-shadow-md" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                        </svg>
                                                    </div>
                                                )}

                                                {/* Label */}
                                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                                    <div className={`text-xs font-medium ${distanceInfo.color}`}>
                                                        {distanceInfo.label}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer Help */}
                        <div className="flex-none p-3 border-t border-gray-800 bg-gray-800/30 text-xs text-gray-500">
                            💡 Tip: Faces with higher difference percentages are more likely to be misassigned.
                            Removing them will move them back to the "Unnamed Faces" pool.
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* Rename Modal */}
            <RenameModal
                isOpen={isRenameModalOpen}
                onClose={() => setIsRenameModalOpen(false)}
                onConfirm={handleMoveSelected}
                initialValue=""
                count={selectedIds.size}
            />
        </>
    );
}
