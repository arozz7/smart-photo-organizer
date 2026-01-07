import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PersonFaceItem from '../components/PersonFaceItem';
import BlurryFacesModal from '../components/BlurryFacesModal';
import AllFacesModal from '../components/AllFacesModal';
import TargetedScanModal from '../components/TargetedScanModal';
import RenameModal from '../components/modals/RenameModal';
import EditPersonNameModal from '../components/modals/EditPersonNameModal';
import OutlierReviewModal from '../components/OutlierReviewModal';
import { useAI } from '../context/AIContext';
import { usePersonDetail } from '../hooks/usePersonDetail';

const PersonDetail = () => {
    const { personId } = useParams();
    const navigate = useNavigate();
    const { setThrottled } = useAI();

    // UI State for Modals
    const [isBlurryModalOpen, setIsBlurryModalOpen] = useState(false);
    const [isAllFacesModalOpen, setIsAllFacesModalOpen] = useState(false);
    const [isNameEditOpen, setIsNameEditOpen] = useState(false);
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [isScanModalOpen, setIsScanModalOpen] = useState(false);
    const [isOutlierModalOpen, setIsOutlierModalOpen] = useState(false);

    // Business Logic from Hook
    const {
        person,
        faces,
        loading,
        selectedFaces,
        isScanning,
        toggleSelection,
        clearSelection,
        selectAll,
        refresh,
        actions,
        // Eras
        eras,
        // Outlier detection (Phase 1)
        outliers,
        isAnalyzingOutliers
    } = usePersonDetail(personId);

    // AI Throttling on mount
    useEffect(() => {
        setThrottled(true);
        return () => setThrottled(false);
    }, [setThrottled]);

    // Handlers
    const onRenamePerson = async (newName: string) => {
        const success = await actions.renamePerson(newName);
        if (success) {
            setIsNameEditOpen(false);
        }
    };

    const onMoveFaces = async (targetName: string) => {
        const success = await actions.moveFaces(targetName);
        if (success) {
            setIsRenameModalOpen(false);
        }
    };

    const onStartScan = async (options: { folderPath?: string, onlyWithFaces?: boolean }) => {
        setIsScanModalOpen(false);
        await actions.startTargetedScan(options);
    };

    const onSetCover = async (faceId: number) => {
        await actions.setCover(faceId);
    };

    const onShuffleCover = async () => {
        // Pick a random face from the top 50 sharpest faces to ensure quality
        if (faces.length === 0) return;

        // Filter valid candidates (sharp enough)
        const candidates = faces
            .filter(f => !f.is_ignored && (f.blur_score || 0) > 20)
            .sort((a, b) => (b.blur_score || 0) - (a.blur_score || 0))
            .slice(0, 50);

        const pool = candidates.length > 0 ? candidates : faces;
        const randomFace = pool[Math.floor(Math.random() * pool.length)];

        if (randomFace) {
            await actions.setCover(randomFace.id);
        }
    };

    const onUnpinCover = async () => {
        await actions.setCover(null);
    };

    if (loading && !person) return <div className="p-8 text-white">Loading...</div>;
    if (!person) return <div className="p-8 text-white">Person not found</div>;

    return (
        <div className="h-full flex flex-col bg-gray-900 text-white p-6 overflow-hidden">
            {/* Header */}
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
                    <div className="flex gap-2 mr-4 border-r border-gray-700 pr-4">
                        {person.cover_face_id ? (
                            <button
                                onClick={onUnpinCover}
                                className="p-2 text-yellow-500 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-colors"
                                title="Unpin Cover Photo (Revert to Auto)"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                                </svg>
                            </button>
                        ) : (
                            <button
                                onClick={onShuffleCover}
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                                title="Shuffle Cover Photo"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                        )}
                    </div>

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
                        onClick={() => setIsAllFacesModalOpen(true)}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                        title="Review complete list of faces"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                        Review All
                    </button>

                    <button
                        onClick={async () => {
                            const found = await actions.findOutliers();
                            if (found && found.length > 0) {
                                setIsOutlierModalOpen(true);
                            }
                        }}
                        disabled={isAnalyzingOutliers}
                        className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
                        title="Find faces that may have been incorrectly assigned to this person"
                    >
                        {isAnalyzingOutliers ? (
                            <div className="animate-spin h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        )}
                        {isAnalyzingOutliers ? 'Analyzing...' : 'Find Misassigned'}
                    </button>

                    <button
                        onClick={actions.recalculateModel}
                        className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
                        title="Force recalculate the person's facial model (centroid) based on current faces. Useful after cleaning up bad assignments."
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Recalculate Model
                    </button>

                    <button
                        onClick={actions.generateEras}
                        className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
                        title="Analyze confirmed faces to detect age clusters (Eras) and create specific models for each time period."
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Generate Eras
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

                    {/* Selection Controls */}
                    <div className="flex gap-2 border-l border-gray-700 pl-4 ml-2">
                        <button
                            onClick={selectAll}
                            className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                            title="Select all faces"
                        >
                            Select All
                        </button>
                        {selectedFaces.size > 0 && (
                            <button
                                onClick={clearSelection}
                                className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                                title="Clear selection"
                            >
                                Clear ({selectedFaces.size})
                            </button>
                        )}
                    </div>

                    {selectedFaces.size > 0 && (
                        <div className="flex gap-2">
                            <button
                                onClick={async () => {
                                    // @ts-ignore
                                    await window.ipcRenderer.invoke('db:confirmFaces', Array.from(selectedFaces));
                                    clearSelection();
                                    refresh();
                                }}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
                                title="Mark as correctly assigned (for reference-based outlier detection)"
                            >
                                ✓ Confirm ({selectedFaces.size})
                            </button>
                            <button
                                onClick={() => setIsRenameModalOpen(true)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                Move / Rename ({selectedFaces.size})
                            </button>
                            <button
                                onClick={actions.removeFaces}
                                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                Remove ({selectedFaces.size})
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            <BlurryFacesModal
                open={isBlurryModalOpen}
                onOpenChange={setIsBlurryModalOpen}
                personId={personId ? parseInt(personId) : null}
                onDeleteComplete={refresh}
            />

            <AllFacesModal
                isOpen={isAllFacesModalOpen}
                onClose={() => setIsAllFacesModalOpen(false)}
                personId={personId ? parseInt(personId) : 0}
                personName={person.name}
                onUpdate={refresh}
            />

            <TargetedScanModal
                isOpen={isScanModalOpen}
                onClose={() => setIsScanModalOpen(false)}
                onStart={onStartScan}
                onSuccess={refresh}
                personName={person?.name}
                personId={person?.id}
            />

            <RenameModal
                isOpen={isRenameModalOpen}
                onClose={() => setIsRenameModalOpen(false)}
                onConfirm={onMoveFaces}
                initialValue=""
                count={selectedFaces.size}
                faceIds={Array.from(selectedFaces)}
            />

            <EditPersonNameModal
                isOpen={isNameEditOpen}
                onClose={() => setIsNameEditOpen(false)}
                currentName={person.name}
                onRename={onRenamePerson}
            />

            <OutlierReviewModal
                isOpen={isOutlierModalOpen}
                onClose={() => setIsOutlierModalOpen(false)}
                personName={person.name}
                outliers={outliers}
                onRemoveFaces={async (faceIds) => {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:unassignFaces', faceIds);
                    actions.resolveOutliers(faceIds);
                }}
                onMoveFaces={async (faceIds, targetName) => {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:moveFacesToPerson', faceIds, targetName);
                    actions.resolveOutliers(faceIds);
                }}
                onConfirmFaces={async (faceIds) => {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:confirmFaces', faceIds);
                    // Confirmed faces are removed from outliers list (handled in modal)
                }}
                onRefresh={refresh}
            />

            {/* Eras List (if any) */}
            {eras && eras.length > 0 && (
                <div className="mb-6 bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                    <h3 className="text-sm uppercase tracking-wider text-gray-400 font-bold mb-3 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Generated Eras
                    </h3>
                    <div className="flex flex-wrap gap-3">
                        {eras.map((era: any) => (
                            <div key={era.id} className="bg-gray-900 border border-gray-600 rounded-lg p-3 flex items-center gap-4 min-w-[200px]">
                                <div>
                                    <div className="font-bold text-white">{era.era_name}</div>
                                    <div className="text-xs text-gray-400">
                                        {era.face_count} faces
                                        {era.start_year && ` • ${era.start_year}-${era.end_year}`}
                                    </div>
                                </div>
                                <button
                                    onClick={() => actions.deleteEra(era.id)}
                                    className="ml-auto text-gray-500 hover:text-red-400 p-1 rounded hover:bg-gray-800 transition-colors"
                                    title="Delete Era"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Faces Grid */}
            <div className="flex-1 overflow-y-auto pr-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {faces.map(face => (
                        <PersonFaceItem
                            key={face.id}
                            face={face}
                            isSelected={selectedFaces.has(face.id)}
                            toggleSelection={toggleSelection}
                            isCover={person.cover_face_id === face.id}
                            onSetCover={onSetCover}
                        />
                    ))}
                </div>
            </div>
        </div >
    );
};

export default PersonDetail;
