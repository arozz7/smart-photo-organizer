/**
 * OutlierReviewModal.tsx
 * 
 * Modal for reviewing potentially misassigned faces detected by the
 * distance-from-centroid analysis (Phase 1: Misassigned Face Detection).
 */

import React, { useState, useEffect } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
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
    onConfirmFaces?: (faceIds: number[]) => Promise<void>;  // NEW: Mark as correctly assigned
    onRefresh: () => void;
    isAuditMode?: boolean;
    onIgnoreFaces?: (faceIds: number[]) => Promise<void>;
}

export default function OutlierReviewModal({
    isOpen,
    onClose,
    personName,
    outliers: initialOutliers,
    onRemoveFaces,
    onMoveFaces,
    onConfirmFaces,
    onIgnoreFaces,
    onRefresh,
    isAuditMode
}: OutlierReviewModalProps) {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isProcessing, setIsProcessing] = useState(false);
    const { viewPhoto, viewingPhoto } = useScan();
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    // Local copy of outliers so we can filter out removed faces without closing
    const [localOutliers, setLocalOutliers] = useState<OutlierResult[]>(initialOutliers);
    // Filter to show only unconfirmed faces - Default false in audit mode
    const [showUnconfirmedOnly, setShowUnconfirmedOnly] = useState(false);

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

    // Apply filter to outliers
    const displayedOutliers = showUnconfirmedOnly
        ? localOutliers.filter(o => !o.is_confirmed)
        : localOutliers;

    const selectAll = () => {
        setSelectedIds(new Set(displayedOutliers.map(o => o.faceId)));
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

    const handleIgnoreSelected = async () => {
        if (selectedIds.size === 0 || !onIgnoreFaces) return;

        setIsProcessing(true);
        try {
            await onIgnoreFaces(Array.from(selectedIds));
            // Filter out ignored faces from local state
            setLocalOutliers(prev => prev.filter(o => !selectedIds.has(o.faceId)));
            setSelectedIds(new Set());
            onRefresh();
        } catch (err) {
            console.error('Failed to ignore faces:', err);
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

    const handleConfirmSelected = async () => {
        if (selectedIds.size === 0 || !onConfirmFaces) return;

        setIsProcessing(true);
        try {
            await onConfirmFaces(Array.from(selectedIds));
            // Filter out confirmed faces from local outlier list
            // (they are now marked as correct, no longer outliers)
            setLocalOutliers(prev => prev.filter(o => !selectedIds.has(o.faceId)));
            setSelectedIds(new Set());
            onRefresh();
        } catch (err) {
            console.error('Failed to confirm faces:', err);
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
                                    {isAuditMode ? 'Audit Confirmed Faces' : 'Potentially Misassigned Faces'}
                                    {isAuditMode && (
                                        <span className="px-2 py-0.5 text-xs font-bold text-amber-900 bg-amber-500/80 rounded uppercase tracking-wider">
                                            Audit Mode
                                        </span>
                                    )}
                                </Dialog.Title>
                                <Dialog.Description className="text-sm text-gray-400 mt-1">
                                    {isAuditMode
                                        ? `Reviewing confirmed faces of ${personName} that look different from the model`
                                        : `These faces appear different from ${personName}'s typical appearance`}
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
                                {displayedOutliers.length} potential outlier{displayedOutliers.length !== 1 ? 's' : ''} found
                                {!isAuditMode && showUnconfirmedOnly && ` (filtering ${localOutliers.length - displayedOutliers.length} confirmed)`}
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Unconfirmed filter toggle - Only show if NOT in audit mode */}
                                {!isAuditMode && (
                                    <button
                                        onClick={() => setShowUnconfirmedOnly(!showUnconfirmedOnly)}
                                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${showUnconfirmedOnly
                                            ? 'text-amber-300 bg-amber-900/30 border-amber-500/50 hover:bg-amber-900/50'
                                            : 'text-gray-400 bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                                            }`}
                                    >
                                        {showUnconfirmedOnly ? '✓ Unconfirmed Only' : 'Show Unconfirmed Only'}
                                    </button>
                                )}
                                <button
                                    onClick={selectedIds.size === displayedOutliers.length ? deselectAll : selectAll}
                                    className="px-3 py-1.5 text-sm font-medium text-indigo-300 bg-indigo-900/20 hover:bg-indigo-900/40 border border-indigo-500/30 rounded-lg transition-colors"
                                >
                                    {selectedIds.size === displayedOutliers.length ? 'Deselect All' : 'Select All'}
                                </button>
                            </div>
                            <div className="flex-1" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {displayedOutliers.length === 0 && !isProcessing ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                    <span className="text-4xl mb-4">✓</span>
                                    <p>{showUnconfirmedOnly ? 'All faces are confirmed' : 'No potential misassignments found'}</p>
                                </div>
                            ) : (
                                <div className="relative h-full">
                                    <VirtuosoGrid
                                        style={{ height: '100%' }}
                                        totalCount={displayedOutliers.length}
                                        overscan={100}
                                        components={{
                                            List: React.forwardRef(({ style, children, ...props }: any, ref) => (
                                                <div
                                                    ref={ref}
                                                    {...props}
                                                    style={style}
                                                    className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 min-[2000px]:grid-cols-14 gap-2 p-2"
                                                >
                                                    {children}
                                                </div>
                                            )),
                                            Item: ({ children, ...props }: any) => (
                                                <div {...props} className="aspect-square">
                                                    {children}
                                                </div>
                                            ),
                                        }}
                                        itemContent={(index) => {
                                            const outlier = displayedOutliers[index];
                                            if (!outlier) return null;
                                            const distanceInfo = getDistanceLabel(outlier.distance);
                                            const isSelected = selectedIds.has(outlier.faceId);
                                            return (
                                                <div
                                                    onClick={() => toggleSelection(outlier.faceId)}
                                                    className={`relative cursor-pointer rounded overflow-hidden group border-2 h-full ${isSelected
                                                        ? 'border-red-500 ring-2 ring-red-500/30'
                                                        : 'border-transparent hover:border-gray-600'
                                                        }`}
                                                >
                                                    <FaceThumbnail
                                                        src={`local-resource://${encodeURIComponent(outlier.file_path || '')}`}
                                                        fallbackSrc={outlier.preview_cache_path
                                                            ? `local-resource://${encodeURIComponent(outlier.preview_cache_path)}`
                                                            : `local-resource://${encodeURIComponent(outlier.file_path || '')}?width=300`}
                                                        box={outlier.box}
                                                        originalImageWidth={outlier.photo_width}
                                                        useServerCrop={true}
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute top-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-mono z-10">
                                                        <span className={distanceInfo.color}>
                                                            {(outlier.distance * 100).toFixed(0)}%
                                                        </span>
                                                    </div>
                                                    {outlier.is_confirmed && (
                                                        <div className="absolute top-1 left-1 bg-green-500/80 px-1 py-0.5 rounded text-[8px] font-bold text-white z-10">✓</div>
                                                    )}
                                                    <div className="absolute bottom-6 right-1 hidden group-hover:block z-20">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); viewPhoto(outlier.photo_id); }}
                                                            className="bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1"
                                                            title="View Original Photo"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                    {isSelected && (
                                                        <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                            </svg>
                                                        </div>
                                                    )}
                                                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5">
                                                        <div className={`text-[10px] font-medium ${distanceInfo.color}`}>
                                                            {distanceInfo.label}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }}
                                    />

                                    {/* Loading Overlay */}
                                    {isProcessing && (
                                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-30 flex items-center justify-center">
                                            <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500/30 border-t-indigo-500" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Floating Selection Action Bar */}
                        {selectedIds.size > 0 && (
                            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
                                <div className="text-sm font-medium text-white border-r border-gray-700 pr-4">
                                    {selectedIds.size} selected
                                </div>
                                {onConfirmFaces && !isAuditMode && (
                                    <button
                                        onClick={handleConfirmSelected}
                                        disabled={isProcessing}
                                        className="text-sm font-medium text-green-400 hover:text-green-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                                        title="Mark as correctly assigned"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Confirm
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsRenameModalOpen(true)}
                                    disabled={isProcessing}
                                    className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    Move / Rename
                                </button>

                                <button
                                    onClick={handleRemoveSelected}
                                    disabled={isProcessing}
                                    className="text-sm font-medium text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    title="Unassign faces from this person"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 2.172V17h10.276a7.688 7.688 0 01.524-1.414A6 6 0 009 14z" />
                                    </svg>
                                    Unassign
                                </button>

                                {onIgnoreFaces && (
                                    <button
                                        onClick={handleIgnoreSelected}
                                        disabled={isProcessing}
                                        className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                                        title="Ignore these faces (remove and hide)"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                        </svg>
                                        Ignore
                                    </button>
                                )}

                                <div className="border-l border-gray-700 pl-4">
                                    <button
                                        onClick={deselectAll}
                                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

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
                showSuggestions={false}
            />
        </>
    );
}
