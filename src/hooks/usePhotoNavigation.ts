import { useState, Dispatch, SetStateAction } from 'react'

export interface PhotoNavigationHook {
    viewingPhoto: any | null
    viewPhoto: (photoId: number) => Promise<void>
    setViewingPhoto: (photo: any | null) => void
    navigateToPhoto: (direction: number) => void
    refreshPhoto: (photoId: number) => Promise<void>
}

export function usePhotoNavigation(photos: any[], setPhotos: Dispatch<SetStateAction<any[]>>): PhotoNavigationHook {
    const [viewingPhoto, setViewingPhoto] = useState<any | null>(null)

    const refreshPhoto = async (photoId: number) => {
        try {
            console.log(`[ScanContext] Refreshing photo ${photoId}`);
            // @ts-ignore
            const newPhoto = await window.ipcRenderer.invoke('db:getPhoto', photoId);
            if (newPhoto) {
                const timestamp = new Date().getTime();
                newPhoto.preview_cache_path = newPhoto.preview_cache_path ? `${newPhoto.preview_cache_path}?t=${timestamp}` : null;

                setPhotos(prev => prev.map(p => {
                    if (p.id === photoId) {
                        return { ...newPhoto, _cacheBust: timestamp };
                    }
                    return p;
                }));

                // Also update viewing photo if it's the same one
                if (viewingPhoto && viewingPhoto.id === photoId) {
                    setViewingPhoto({ ...newPhoto, _cacheBust: timestamp });
                }
            }
        } catch (e) {
            console.error('Failed to refresh photo', e);
        }
    }

    const viewPhoto = async (photoId: number) => {
        try {
            // @ts-ignore
            const p = await window.ipcRenderer.invoke('db:getPhoto', photoId)
            if (p) {
                setViewingPhoto(p)
            }
        } catch (e) {
            console.error('Failed to view photo', e)
        }
    }

    const navigateToPhoto = (direction: number) => {
        if (!viewingPhoto || photos.length === 0) return;

        const index = photos.findIndex(p => p.id === viewingPhoto.id);
        if (index !== -1) {
            const nextIndex = index + direction;
            if (nextIndex >= 0 && nextIndex < photos.length) {
                setViewingPhoto(photos[nextIndex]);
            }
        }
    }

    return {
        viewingPhoto,
        viewPhoto,
        setViewingPhoto,
        navigateToPhoto,
        refreshPhoto
    }
}
