import { useState, useEffect } from 'react'
import { useAlert } from '../../context/AlertContext';
import SettingsSection from './SettingsSection';

/** Library Storage: shows the library location and moves it to another folder. */
export default function LibraryStorageSection() {
    const { showAlert, showConfirm } = useAlert();
    const [movingLibrary, setMovingLibrary] = useState(false)
    const [libraryPath, setLibraryPath] = useState(localStorage.getItem('libraryPath') || '')

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('settings:getLibraryPath').then(path => {
            setLibraryPath(path)
            localStorage.setItem('libraryPath', path)
        });
    }, [])

    return (
        <>
            <SettingsSection title="Library Storage">
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                    <div>
                        <h4 className="font-medium text-white">Current Location</h4>
                        <p className="text-sm text-gray-400 mt-1 mb-2 break-all bg-black/30 p-2 rounded font-mono">
                            {libraryPath || 'Loading...'}
                        </p>
                        <p className="text-xs text-gray-500 mb-4">
                            This folder contains your database, generated previews, and AI indices.
                        </p>
                    </div>

                    <div className="flex gap-4">
                        <button
                            onClick={async () => {
                                // @ts-ignore
                                const path = await window.ipcRenderer.invoke('dialog:openDirectory')
                                if (path) {
                                    showConfirm({
                                        title: 'Move Library',
                                        description: `Move library to:\n${path}\n\nThis may take several minutes for large libraries. The application will pause while moving files.`,
                                        confirmLabel: 'Move Library',
                                        onConfirm: async () => {
                                            setMovingLibrary(true);

                                            try {
                                                // @ts-ignore
                                                const res = await window.ipcRenderer.invoke('settings:moveLibrary', path)
                                                if (res.success) {
                                                    showAlert({
                                                        title: 'Move Complete',
                                                        description: 'Library moved successfully. The view will now reload.',
                                                        onConfirm: () => window.location.reload()
                                                    });
                                                } else {
                                                    showAlert({
                                                        title: 'Move Failed',
                                                        description: res.error,
                                                        variant: 'danger'
                                                    });
                                                }
                                            } catch (e) {
                                                showAlert({
                                                    title: 'Error',
                                                    description: 'Move operation failed: ' + String(e),
                                                    variant: 'danger'
                                                });
                                            } finally {
                                                setMovingLibrary(false);
                                            }
                                        }
                                    });
                                }
                            }}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                        >
                            Move Library
                        </button>
                    </div>
                </div>
            </SettingsSection>

            {/* Move Library Blocking Modal */}
            {movingLibrary && (
                <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100]">
                    <div className="bg-gray-800 p-8 rounded-lg border border-indigo-500/50 max-w-md w-full shadow-2xl text-center space-y-6">
                        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-2">Moving Library...</h3>
                            <p className="text-gray-300 text-sm">
                                Please wait while we move your files and database.
                                <br />
                                <span className="text-xs text-gray-500 mt-2 block">Do not close the application.</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
