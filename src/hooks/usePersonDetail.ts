import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlert } from '../context/AlertContext';
import { useToast } from '../context/ToastContext';
import { useAI } from '../context/AIContext';

export interface Face {
    id: number;
    photo_id: number;
    box: { x: number, y: number, width: number, height: number };
    descriptor: number[];
    person_id: number | null;
    file_path: string;
    preview_cache_path: string;
    width: number;
    height: number;
    is_ignored: boolean;
    blur_score?: number; // Added
}

export interface Person {
    id: number;
    name: string;
    cover_face_id?: number | null; // Added
}

// Outlier detection result from backend
export interface OutlierResult {
    faceId: number;
    distance: number;
    blurScore: number | null;
    // Embedded face data for direct display
    box: { x: number; y: number; width: number; height: number };
    photo_id: number; // Added
    file_path: string;
    preview_cache_path: string | null;
    photo_width: number;
    photo_height: number;
    is_confirmed?: boolean; // For filtering unconfirmed faces
}

// ... hook logic ...



export const usePersonDetail = (personId: string | undefined) => {
    const navigate = useNavigate();
    const { showAlert, showConfirm } = useAlert();
    const { addToast } = useToast();
    const { addToQueue } = useAI();

    const [person, setPerson] = useState<Person | null>(null);
    const [faces, setFaces] = useState<Face[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFaces, setSelectedFaces] = useState<Set<number>>(new Set());
    const [isScanning, setIsScanning] = useState(false);

    // Outlier detection state (Phase 1: Misassigned Face Detection)
    const [outliers, setOutliers] = useState<OutlierResult[]>([]);
    const [isAnalyzingOutliers, setIsAnalyzingOutliers] = useState(false);
    const [outlierThreshold, setOutlierThreshold] = useState(1.2);

    // Initial load
    useEffect(() => {
        loadData();
    }, [personId]);

    // Eras logic
    const [eras, setEras] = useState<any[]>([]);

    const loadEras = useCallback(async () => {
        if (!personId) return;
        try {
            // @ts-ignore
            const loadedEras = await window.ipcRenderer.invoke('db:getEras', parseInt(personId));
            setEras(loadedEras);
        } catch (e) {
            console.error('Failed to load eras', e);
        }
    }, [personId]);

    useEffect(() => {
        if (person) {
            loadEras();
        }
    }, [person, loadEras]);

    // ... (rest of the file until return) ...



    const loadData = async () => {
        if (!personId) return;
        setLoading(true);
        try {
            // @ts-ignore
            const p = await window.ipcRenderer.invoke('db:getPerson', parseInt(personId));
            setPerson(p);

            // @ts-ignore
            const allFaces = await window.ipcRenderer.invoke('db:getAllFaces', {
                limit: 1000,
                filter: { personId: parseInt(personId) }
            });
            setFaces(allFaces);
        } catch (err) {
            console.error(err);
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

    const clearSelection = useCallback(() => {
        setSelectedFaces(new Set());
    }, []);

    const selectAll = useCallback(() => {
        setSelectedFaces(new Set(faces.map(f => f.id)));
    }, [faces]);

    const handleReassign = async (name: string): Promise<boolean> => {
        if (!name) return false;
        const count = selectedFaces.size;

        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: Array.from(selectedFaces),
                personName: name
            });

            if (result.success) {
                clearSelection();
                loadData();
                addToast({
                    title: 'Faces Moved',
                    description: `Moved ${count} face${count !== 1 ? 's' : ''} to ${name}.`,
                    type: 'success',
                    duration: 3000
                });
                return true;
            } else {
                showAlert({
                    title: 'Move Failed',
                    description: result.error,
                    variant: 'danger'
                });
                return false;
            }
        } catch (err) {
            console.error(err);
            showAlert({
                title: 'Error',
                description: 'Failed to move faces',
                variant: 'danger'
            });
            return false;
        }
    };

    const handleRenamePerson = async (newName: string): Promise<boolean> => {
        if (!newName || !person || !newName.trim()) return false;

        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:renamePerson', {
                personId: person.id,
                newName: newName.trim()
            });

            if (result.success) {
                if (result.merged) {
                    // Navigate to the target person (merged destination)
                    navigate(`/people/${result.targetId}`, { replace: true });
                } else {
                    // Just refresh
                    loadData();
                }
                return true;
            } else {
                showAlert({
                    title: 'Rename Failed',
                    description: result.error,
                    variant: 'danger'
                });
                return false;
            }
        } catch (err) {
            console.error(err);
            showAlert({
                title: 'Error',
                description: 'Failed to rename person',
                variant: 'danger'
            });
            return false;
        }
    };

    const handleUnassign = async () => {
        if (selectedFaces.size === 0) return;
        const count = selectedFaces.size;
        const personName = person?.name || 'this person';

        showConfirm({
            title: 'Remove Faces',
            description: `Remove ${selectedFaces.size} faces from ${person?.name}?`,
            confirmLabel: 'Remove Faces',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:unassignFaces', Array.from(selectedFaces));
                    clearSelection();
                    loadData(); // Refresh
                    addToast({
                        title: 'Faces Removed',
                        description: `Removed ${count} face${count !== 1 ? 's' : ''} from ${personName}.`,
                        type: 'success',
                        duration: 3000
                    });
                } catch (err) {
                    console.error(err);
                    showAlert({
                        title: 'Error',
                        description: 'Failed to remove faces',
                        variant: 'danger'
                    });
                }
            }
        });
    };

    const handleTargetedScan = async (options: { folderPath?: string, onlyWithFaces?: boolean }) => {
        if (!person) return;
        setIsScanning(true);
        try {
            // @ts-ignore
            const candidates = await window.ipcRenderer.invoke('db:getPhotosForTargetedScan', options);
            if (candidates && candidates.length > 0) {
                const photosToScan = candidates.map((p: any) => ({ ...p, scanMode: 'MACRO' }));
                addToQueue(photosToScan);
                showAlert({
                    title: 'Scan Started',
                    description: `${candidates.length} photos added to the AI queue.`
                });
                return true;
            } else {
                showAlert({
                    title: 'No Photos Found',
                    description: 'No photos match the selected criteria for a targeted scan.'
                });
                return false;
            }
        } catch (err) {
            console.error(err);
            return false;
        } finally {
            setIsScanning(false);
        }
    };

    // Find potentially misassigned faces (Phase 1)
    const findOutliers = useCallback(async (threshold?: number) => {
        if (!personId) return;

        setIsAnalyzingOutliers(true);
        setOutliers([]);

        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('person:findOutliers', {
                personId: parseInt(personId),
                threshold: threshold ?? outlierThreshold
            });

            if (result.success) {
                setOutliers(result.outliers || []);
                if (!result.centroidValid) {
                    showAlert({
                        title: 'No Reference Available',
                        description: `${person?.name} has no valid face embeddings to compare against. Try running an AI scan first.`
                    });
                } else if (result.outliers.length === 0) {
                    showAlert({
                        title: 'All Faces Match',
                        description: `All ${result.totalFaces} faces appear to be correctly assigned.`
                    });
                }
                return result.outliers;
            } else {
                showAlert({
                    title: 'Analysis Failed',
                    description: result.error || 'Unknown error',
                    variant: 'danger'
                });
                return [];
            }
        } catch (err) {
            console.error('findOutliers error:', err);
            showAlert({
                title: 'Error',
                description: 'Failed to analyze faces for outliers',
                variant: 'danger'
            });
            return [];
        } finally {
            setIsAnalyzingOutliers(false);
        }
    }, [personId, outlierThreshold, person, showAlert]);



    const resolveOutliers = useCallback((resolvedFaceIds: number[]) => {
        setOutliers(prev => prev.filter(o => !resolvedFaceIds.includes(o.faceId)));
        loadData();
        addToast({
            title: 'Faces Updated',
            description: `Successfully updated ${resolvedFaceIds.length} face${resolvedFaceIds.length !== 1 ? 's' : ''}.`,
            type: 'success',
            duration: 3000
        });
    }, [loadData, addToast]);

    const recalculateModel = async () => {
        if (!person) return;
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:recalculatePersonModel', person.id);

            if (result.drift) {
                addToast({
                    title: 'Drift Detected',
                    description: `The facial model changed significantly (dist: ${result.driftDistance.toFixed(3)}). Please verify matches.`,
                    type: 'warning',
                    duration: 6000
                });
            } else {
                addToast({
                    title: 'Model Updated',
                    description: `Recalculated facial model for ${person.name}.`,
                    type: 'success',
                    duration: 3000
                });
            }
        } catch (e) {
            console.error(e);
            showAlert({
                title: 'Error',
                description: 'Failed to recalculate model',
                variant: 'danger'
            });
        }
    }

    const generateEras = async () => {
        if (!person) return;
        try {
            // @ts-ignore
            const settings = await window.ipcRenderer.invoke('ai:getSettings');
            const eraConfig = {
                minFacesForEra: settings?.minFacesForEra ?? 50,
                eraMergeThreshold: settings?.eraMergeThreshold ?? 0.75
            };
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:generateEras', {
                personId: person.id,
                config: eraConfig
            });
            if (result.success) {
                loadEras(); // Reload eras
                if (result.count === 0) {
                    addToast({
                        title: 'No Eras Generated',
                        description: 'Faces are too close visually or not enough data.',
                        type: 'info',
                        duration: 3000
                    });
                } else {
                    addToast({
                        title: 'Eras Generated',
                        description: `Successfully created ${result.count} visual eras for ${person.name}.`,
                        type: 'success',
                        duration: 3000
                    });
                }
            } else {
                addToast({
                    title: 'Generation Failed',
                    description: `Cannot generate eras: ${result.error || result.reason || 'Unknown error'}`,
                    type: 'warning',
                    duration: 4000
                });
            }
        } catch (e) {
            console.error(e);
            showAlert({
                title: 'Error',
                description: 'Failed to generate eras',
                variant: 'danger'
            });
        }
    }

    const deleteEra = async (eraId: number) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:deleteEra', eraId);
            addToast({ title: 'Era Deleted', description: 'Manually removed era.', type: 'info' });
            loadEras();
        } catch (e) {
            console.error(e);
            showAlert({ title: 'Error', description: 'Failed to delete era', variant: 'danger' });
        }
    };

    const handleSetCover = async (faceId: number | null) => {
        if (!person) return false;
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:setPersonCover', { personId: person.id, faceId });
            await loadData();
            return true;
        } catch (e) {
            console.error('Failed to set cover', e);
            showAlert({ title: 'Error', description: 'Failed to set cover photo', variant: 'danger' });
            return false;
        }
    };

    return {
        person,
        faces,
        loading,
        selectedFaces,
        isScanning,
        toggleSelection,
        selectAll,
        deselectAll: clearSelection,
        clearSelection,
        refresh: loadData,

        // Outlier detection exports
        outliers,
        isAnalyzingOutliers,
        outlierThreshold,
        setOutlierThreshold,

        // Eras
        eras,

        actions: {
            moveFaces: handleReassign,
            // @ts-ignore
            removeFaces: handleUnassign,
            setCover: handleSetCover,
            renamePerson: handleRenamePerson,
            startTargetedScan: handleTargetedScan,
            loadMore: async () => { }, // Placeholder if loadMore is not implemented
            ignoreFaces: async () => { }, // Placeholder
            confirmFaces: async () => { }, // Placeholder
            findOutliers,
            clearOutliers: () => setOutliers([]),
            resolveOutliers,
            recalculateModel,
            generateEras,
            deleteEra
        }
    };
};
