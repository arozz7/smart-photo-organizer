import { useState } from 'react'
import { useAlert } from '../../context/AlertContext';

interface FactoryResetModalProps {
    onClose: () => void
}

/** Typed-confirmation dialog for the factory reset. Render it only while it is open: its input starts empty each time. */
export default function FactoryResetModal({ onClose }: FactoryResetModalProps) {
    const { showAlert } = useAlert();
    const [resetInput, setResetInput] = useState('')

    const handleFactoryReset = async () => {
        if (resetInput !== 'RESET') return

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:factoryReset')
            if (res.success) {
                showAlert({
                    title: 'Reset Complete',
                    description: 'Factory reset complete. Application will now reload.',
                    onConfirm: () => window.location.reload()
                });
            } else {
                showAlert({
                    title: 'Reset Failed',
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

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-8 rounded-lg border border-red-500/50 max-w-md w-full shadow-2xl">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <span className="text-red-500">⚠️</span> Factory Reset
                </h3>
                <div className="space-y-4">
                    <p className="text-gray-300">
                        This will <strong>permanently delete</strong> all data from your library database, including:
                    </p>
                    <ul className="list-disc list-inside text-gray-400 text-sm pl-2">
                        <li>All photo index data</li>
                        <li>All generated tags</li>
                        <li>All detected faces and people names</li>
                        <li>All generated thumbnails</li>
                    </ul>
                    <p className="text-red-400 text-sm font-semibold">
                        This action cannot be undone.
                    </p>

                    <div className="pt-2">
                        <label className="block text-gray-400 text-xs mb-1">To confirm, type <span className="font-mono font-bold text-white">RESET</span> below:</label>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-red-900 rounded px-3 py-2 text-white focus:border-red-500 outline-none"
                            placeholder="Type RESET"
                            value={resetInput}
                            onChange={e => setResetInput(e.target.value)}
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded text-gray-300 hover:bg-gray-700"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleFactoryReset}
                            disabled={resetInput !== 'RESET'}
                            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                        >
                            Confirm Reset
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
