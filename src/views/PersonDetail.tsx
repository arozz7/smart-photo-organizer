import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PersonFaceItem from '../components/PersonFaceItem';
import BlurryFacesModal from '../components/BlurryFacesModal';
import AllFacesModal from '../components/AllFacesModal';
import TargetedScanModal from '../components/TargetedScanModal';
import RenameModal from '../components/modals/RenameModal';
import EditPersonNameModal from '../components/modals/EditPersonNameModal';
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

    // Business Logic from Hook
    const {
        person,
        faces,
        loading,
        selectedFaces,
        isScanning,
        toggleSelection,
        refresh,
        actions
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

    if (loading) return <div className="p-8 text-white">Loading...</div>;
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

                    {selectedFaces.size > 0 && (
                        <div className="flex gap-2">
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
            />

            <EditPersonNameModal
                isOpen={isNameEditOpen}
                onClose={() => setIsNameEditOpen(false)}
                currentName={person.name}
                onRename={onRenamePerson}
            />

            {/* Faces Grid */}
            <div className="flex-1 overflow-y-auto pr-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {faces.map(face => (
                        <PersonFaceItem
                            key={face.id}
                            face={face}
                            isSelected={selectedFaces.has(face.id)}
                            toggleSelection={toggleSelection}
                        />
                    ))}
                </div>
            </div>
        </div >
    );
};

export default PersonDetail;
