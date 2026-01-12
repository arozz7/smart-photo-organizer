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
    const handleConfirmSuggestion = useCallback(async (bucket: FaceBucket, faceIds?: number[]) => {
        if (!bucket.suggested_person_id) return;

        // Optimistic update
        if (faceIds && faceIds.length > 0) {
            setSuggestionBuckets(prev => prev.map(b => {
                if (b.id === bucket.id) {
                    const remainingIds = b.face_ids.filter(id => !faceIds.includes(id));
                    if (remainingIds.length === 0) return null;
                    return { ...b, face_ids: remainingIds, face_count: remainingIds.length };
                }
                return b;
            }).filter((b): b is FaceBucket => b !== null));
        } else {
            setSuggestionBuckets(prev => prev.filter(b => b.id !== bucket.id));
        }

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:confirmSuggestionBucket', {
                bucketId: bucket.id,
                personId: bucket.suggested_person_id,
                faceIds
            });

            if (res.success) {
                const count = faceIds ? faceIds.length : bucket.face_count;
                addToast({ type: 'success', description: `Confirmed ${count} faces for ${bucket.person_name}` });
                // Reload people counts eventually
                loadPeople(); // Background refresh
            } else {
                throw new Error(res.error);
            }
        } catch (e) {
            console.error(e);
            addToast({ type: 'error', description: 'Failed to confirm suggestion.' });
            loadBuckets(); // Revert
        }
    }, [loadPeople, addToast, loadBuckets]);

    // Handle Reject Suggestion (Dissolve bucket, unassign faces)
    const handleRejectSuggestion = useCallback(async (bucket: FaceBucket) => {
        // Optimistic update
        setSuggestionBuckets(prev => prev.filter(b => b.id !== bucket.id));

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:rejectSuggestionBucket', bucket.id);

            if (res.success) {
                addToast({ type: 'info', description: `Rejected suggestion. Faces moved to Unnamed.` });
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
    const handleNameBucket = useCallback(async (bucket: FaceBucket, name: string) => {
        if (!name.trim()) return;

        console.log('[useBuckets] handleNameBucket called:', { bucketId: bucket.id, name, faceCount: bucket.face_count });

        // Optimistic update
        setDiscoveryBuckets(prev => {
            const filtered = prev.filter(b => b.id !== bucket.id);
            console.log('[useBuckets] Optimistic update: prev=', prev.length, 'filtered=', filtered.length);
            return filtered;
        });

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
                addToast({ type: 'success', description: `Named group "${name}"` });
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
    const handleIgnoreBucket = useCallback(async (bucket: FaceBucket) => {
        showConfirm({
            title: 'Ignore Group',
            description: `Ignore these ${bucket.face_count} faces? They will be hidden from Unnamed faces.`,
            confirmLabel: 'Ignore',
            variant: 'danger',
            onConfirm: async () => {
                // Optimistic
                setDiscoveryBuckets(prev => prev.filter(b => b.id !== bucket.id));
                setSuggestionBuckets(prev => prev.filter(b => b.id !== bucket.id));

                try {
                    // Using the generic face ignore, but we might want a bucket specific ignore if we want to change bucket status?
                    // For now, let's just ignore the faces. The bucket remains 'active' but empty?
                    // Actually, if we ignore faces, they technically leave the bucket logic (if queries filter ignored faces).
                    // But the bucket itself should probably be marked completed or deleted?
                    // Let's use db:ignoreFaces on the ids.

                    // We need the IDs? The bucket object has them.
                    if (bucket.face_ids.length > 0) {
                        // @ts-ignore
                        await window.ipcRenderer.invoke('db:ignoreFaces', bucket.face_ids);
                        // Also, we should probably delete the bucket or mark it handled so it doesn't show up empty.
                        // db:rejectSuggestionBucket deletes it.
                        // Let's call reject as well? Or just rely on re-scan cleaning it up.
                        // Ideally we have db:ignoreBucket.
                        // Since we don't, we'll fall back to ignoring faces + rejecting/deleting bucket structure.

                        // Actually, just calling rejectSuggestionBucket effectively "unbuckets" them.
                        // But we want to set is_ignored=1 on faces.

                        // Correct flow: Ignore faces -> Faces.is_ignored=1.
                        // Bucket query filters is_ignored=0. So bucket becomes empty.
                        // Orphan cleanup (on startup) handles empty buckets.
                        // So just ignoring faces is sufficient for UI.
                    }

                    addToast({ type: 'success', description: `Ignored group.` });
                } catch (e) {
                    console.error(e);
                    addToast({ type: 'error', description: 'Failed to ignore group.' });
                    loadBuckets();
                }
            }
        });
    }, [showConfirm, addToast, loadBuckets]);

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
