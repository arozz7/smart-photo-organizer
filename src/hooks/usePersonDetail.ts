import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlert } from '../context/AlertContext';
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
}

export interface Person {
    id: number;
    name: string;
}

export const usePersonDetail = (personId: string | undefined) => {
    const navigate = useNavigate();
    const { showAlert, showConfirm } = useAlert();
    const { addToQueue } = useAI();

    const [person, setPerson] = useState<Person | null>(null);
    const [faces, setFaces] = useState<Face[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFaces, setSelectedFaces] = useState<Set<number>>(new Set());
    const [isScanning, setIsScanning] = useState(false);

    // Initial load
    useEffect(() => {
        loadData();
    }, [personId]);

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

    const handleReassign = async (name: string): Promise<boolean> => {
        if (!name) return false;

        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: Array.from(selectedFaces),
                personName: name
            });

            if (result.success) {
                clearSelection();
                loadData();
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

    return {
        person,
        faces,
        loading,
        selectedFaces,
        isScanning,
        toggleSelection,
        clearSelection,
        refresh: loadData,
        actions: {
            renamePerson: handleRenamePerson,
            moveFaces: handleReassign,
            // @ts-ignore
            removeFaces: handleUnassign,
            startTargetedScan: handleTargetedScan
        }
    };
};
