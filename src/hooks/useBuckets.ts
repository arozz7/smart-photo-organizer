import { useState, useCallback, useEffect } from 'react';
import { usePeople } from '../context/PeopleContext';
import { useAlert } from '../context/AlertContext';
import { useToast } from '../context/ToastContext';
import { FaceBucket } from '../types';



export function useBuckets() {
    const { people, loadPeople, fetchFacesByIds } = usePeople();
    const { showConfirm } = useAlert();
    const { addToast } = useToast();

    const [suggestionBuckets, setSuggestionBuckets] = useState<FaceBucket[]>([]);
    const [discoveryBuckets, setDiscoveryBuckets] = useState<FaceBucket[]>([]);
    const [loadingBuckets, setLoadingBuckets] = useState(false);
    const [recheckStatus, setRecheckStatus] = useState({ active: false, offset: 0, total: 0 });

    const checkRecheckStatus = useCallback(async () => {
        try {
            // @ts-ignore
            const status = await window.ipcRenderer.invoke('db:getIgnoredRecheckStatus');
            setRecheckStatus(status);
        } catch (e) {
            console.error("Failed to check recheck status", e);
        }
    }, []);

    // Initial load & Polling
    const loadBuckets = useCallback(async () => {
        setLoadingBuckets(true);
        try {
            // @ts-ignore
            const suggestionsRes = await window.ipcRenderer.invoke('db:getSuggestionBuckets');
            if (suggestionsRes.success) {
                setSuggestionBuckets(suggestionsRes.buckets);
            }

            // @ts-ignore
            const discoveryRes = await window.ipcRenderer.invoke('db:getDiscoveryBuckets');
            if (discoveryRes.success) {
                setDiscoveryBuckets(discoveryRes.buckets);
            }

            await checkRecheckStatus();

        } catch (e) {
            console.error("Failed to load buckets", e);
            addToast({ type: 'error', description: 'Failed to load suggestions.' });
        } finally {
            setLoadingBuckets(false);
        }
    }, [addToast, checkRecheckStatus]);

    // Poll for recheck status if active
    // We poll every 1s when active for progress visibility, 5s when idle
    // Poll for recheck status
    useEffect(() => {
        const pollInterval = recheckStatus.active ? 1000 : 5000;
        const interval = setInterval(() => {
            checkRecheckStatus();
        }, pollInterval);
        return () => clearInterval(interval);
    }, [checkRecheckStatus, recheckStatus.active]);

    // Handle Confirm Suggestion
    const handleConfirmSuggestion = useCallback(async (bucket: FaceBucket, faceIds?: number[], options: { suppressToast?: boolean, skipRecalc?: boolean } = {}) => {
        if (!bucket.suggested_person_id) return;

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:confirmSuggestionBucket', {
                bucketId: bucket.id,
                personId: bucket.suggested_person_id,
                faceIds,
                skipRecalc: options.skipRecalc
            });

            if (res.success) {
                setSuggestionBuckets(prev => {
                    // Logic to remove bucket or update face count...
                    // (Matches existing logic logic below)
                    if (faceIds && faceIds.length < bucket.face_count) {
                        return prev.map(b => b.id === bucket.id ? { ...b, face_ids: b.face_ids.filter(id => !faceIds.includes(id)), face_count: b.face_count - faceIds.length } : b);
                    }
                    return prev.filter(b => b.id !== bucket.id);
                });

                if (!options.suppressToast) {
                    addToast({
                        type: 'success',
                        title: 'Suggestion Confirmed',
                        description: `Confirmed faces for ${bucket.person_name}`
                    });
                }

                // Only reload if not skipping recalc (usually they go together)
                if (!options.skipRecalc) {
                    loadPeople();
                }
            } else {
                addToast({ type: 'error', title: 'Error', description: res.error });
            }
        } catch (error) {
            console.error(error);
            addToast({ type: 'error', title: 'Error', description: 'Failed to confirm suggestion' });
        }
    }, [addToast, loadPeople]);

    // Handle Reject Suggestion (Dissolve bucket, unassign faces)
    const handleRejectSuggestion = useCallback(async (bucket: FaceBucket, options: { suppressToast?: boolean } = {}) => {
        // Optimistic update
        setSuggestionBuckets(prev => prev.filter(b => b.id !== bucket.id));

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:rejectSuggestionBucket', bucket.id);

            if (res.success) {
                if (!options.suppressToast) {
                    addToast({ type: 'info', description: `Rejected suggestion. Faces moved to Unnamed.` });
                }
            } else {
                throw new Error(res.error);
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', description: 'Failed to reject suggestion.' });
            loadBuckets(); // Revert
        }
    }, [addToast, loadBuckets]);

    // Handle Naming Discovery Bucket
    const handleNameBucket = useCallback(async (bucket: FaceBucket, name: string, options: { suppressToast?: boolean } = {}) => {
        if (!name.trim()) return;

        console.log('[useBuckets] handleNameBucket called:', { bucketId: bucket.id, name, faceCount: bucket.face_count });

        // Optimistic update - remove from both lists like handleIgnoreBucket does
        setDiscoveryBuckets(prev => {
            const filtered = prev.filter(b => String(b.id) !== String(bucket.id));
            console.log('[useBuckets] Optimistic update (discoveries):', {
                bucketId: bucket.id,
                prevLength: prev.length,
                filteredLength: filtered.length,
                removedCount: prev.length - filtered.length
            });
            return filtered;
        });
        setSuggestionBuckets(prev => prev.filter(b => String(b.id) !== String(bucket.id)));

        // Check if person exists
        const existingPerson = people.find(p => p.name.toLowerCase() === name.toLowerCase());

        try {
            let res;
            if (existingPerson) {
                // Assign to existing
                // @ts-ignore
                res = await window.ipcRenderer.invoke('db:assignBucketToPerson', {
                    bucketId: bucket.id,
                    personId: existingPerson.id
                });
            } else {
                // Create new
                // @ts-ignore
                res = await window.ipcRenderer.invoke('db:nameDiscoveryBucket', {
                    bucketId: bucket.id,
                    newName: name
                });
            }

            if (res.success) {
                if (!options.suppressToast) {
                    addToast({ type: 'success', description: `Named group "${name}"` });
                }
                loadPeople();
            } else {
                throw new Error(res.error);
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', description: 'Failed to name group.' });
            loadBuckets();
        }
    }, [people, loadPeople, addToast, loadBuckets]);

    // Handle Ignore Bucket
    const handleIgnoreBucket = useCallback(async (bucket: FaceBucket, options: { suppressToast?: boolean, skipConfirmation?: boolean } = {}) => {
        const executeIgnore = async () => {
            // Optimistic
            setDiscoveryBuckets(prev => prev.filter(b => b.id !== bucket.id));
            setSuggestionBuckets(prev => prev.filter(b => b.id !== bucket.id));

            try {
                if (bucket.face_ids.length > 0) {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:ignoreFaces', bucket.face_ids);
                }

                if (!options.suppressToast) {
                    addToast({ type: 'success', description: `Ignored group.` });
                }
            } catch (e) {
                console.error(e);
                addToast({ type: 'error', description: 'Failed to ignore group.' });
                loadBuckets();
            }
        };

        if (options.skipConfirmation) {
            await executeIgnore();
        } else {
            showConfirm({
                title: 'Ignore Group',
                description: `Ignore these ${bucket.face_count} faces? They will be hidden from Unnamed faces.`,
                confirmLabel: 'Ignore',
                variant: 'danger',
                onConfirm: executeIgnore
            });
        }
    }, [addToast, loadBuckets, showConfirm]);

    const handleStartRecheck = useCallback(async () => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:startIgnoredRecheck');
            addToast({ type: 'info', description: 'Started re-checking ignored faces...' });
            checkRecheckStatus(); // Update immediately
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', description: 'Failed to start re-check.' });
        }
    }, [addToast, checkRecheckStatus]);

    // NOTE: Pagination is now handled by the consumer (useClusterController) to perform client-side filtering/virtualization.
    // We export the full bucket lists.

    return {
        // Return FULL lists
        suggestionBuckets,
        discoveryBuckets,
        // Full counts for tab indicators
        totalSuggestionCount: suggestionBuckets.length,
        totalDiscoveryCount: discoveryBuckets.length,
        // Other exports
        loadingBuckets,
        recheckStatus,
        loadBuckets,
        handleConfirmSuggestion,
        handleRejectSuggestion,
        handleNameBucket,
        handleIgnoreBucket,
        handleStartRecheck,
        fetchFacesByIds
    };
}
