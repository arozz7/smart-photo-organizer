import { useState } from 'react'
import { useAlert } from '../context/AlertContext'

/**
 * Confirmed database maintenance actions from the Settings screen:
 * clear AI tags, normalise tags and remove duplicate faces.
 *
 * `onBusyChange` reports the "clearing" state of Clear Tags to the screen, which shares that flag
 * with the library move (see LibraryStorageSection).
 */
export function useDatabaseMaintenance(onBusyChange: (busy: boolean) => void) {
    const { showAlert, showConfirm } = useAlert();
    const [message, setMessage] = useState('')

    const clearAiTags = () => {
        showConfirm({
            title: 'Clear AI Tags',
            description: 'Are you sure you want to delete ALL AI-generated tags? This cannot be undone.',
            confirmLabel: 'Delete All Tags',
            variant: 'danger',
            onConfirm: async () => {
                onBusyChange(true)
                try {
                    // @ts-ignore
                    const result = await window.ipcRenderer.invoke('db:clearAITags')
                    if (result.success) {
                        setMessage('Successfully cleared all AI tags.')
                    } else {
                        setMessage('Failed to clear tags: ' + result.error)
                    }
                } catch (error) {
                    setMessage('Error invoking command: ' + error)
                } finally {
                    onBusyChange(false)
                }
            }
        });
    }

    const cleanupTags = () => {
        showConfirm({
            title: 'Cleanup Tags',
            description: `This will normalize ALL existing tags:\n\n1. Convert to lowercase\n2. Split phrases into single words\n3. Remove punctuation\n4. Merge duplicates\n\nThis cannot be undone.`,
            confirmLabel: 'Run Cleanup',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    const res = await window.ipcRenderer.invoke('db:cleanupTags');
                    if (res.success) {
                        showAlert({
                            title: 'Cleanup Complete',
                            description: `Cleanup finished.\nTags Deleted: ${res.deletedCount}\nLinks Updated: ${res.mergedCount}`
                        });
                    } else {
                        showAlert({
                            title: 'Cleanup Failed',
                            description: res.error,
                            variant: 'danger'
                        });
                    }
                } catch (e) {
                    showAlert({
                        title: 'Error',
                        description: String(e),
                        variant: 'danger'
                    });
                }
            }
        });
    }

    const removeDuplicateFaces = () => {
        showConfirm({
            title: 'Deduplicate Faces',
            description: 'Find and remove duplicate faces? This will keep named faces and remove duplicates.',
            confirmLabel: 'Start Cleanup',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    const res = await window.ipcRenderer.invoke('db:removeDuplicateFaces')
                    showAlert({
                        title: 'Cleanup Complete',
                        description: `Removed ${res.removedCount} duplicate faces.`
                    });
                } catch (e) {
                    showAlert({
                        title: 'Cleanup Failed',
                        description: String(e),
                        variant: 'danger'
                    });
                }
            }
        });
    }

    return { message, clearAiTags, cleanupTags, removeDuplicateFaces }
}
