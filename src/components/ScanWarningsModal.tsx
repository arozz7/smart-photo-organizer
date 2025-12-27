import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

interface ScanError {
    id: number
    photo_id: number | null
    file_path: string
    error_message: string
    stage: string
    timestamp: string
}

interface ScanWarningsModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function ScanWarningsModal({ isOpen, onClose }: ScanWarningsModalProps) {
    const [errors, setErrors] = useState<ScanError[]>([])
    const [loading, setLoading] = useState(false)
    const [deleting, setDeleting] = useState<number | null>(null)

    const loadErrors = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getScanErrors')
            if (res.success) {
                setErrors(res.errors)
            }
        } catch (e) {
            console.error("Failed to load scan errors", e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (isOpen) {
            loadErrors()
        }
    }, [isOpen])

    const handleDelete = async (id: number, deleteFile: boolean) => {
        if (!confirm(deleteFile ? "Permanently delete this file?" : "Dismiss this warning?")) return;

        setDeleting(id)
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:deleteScanError', { id, deleteFile })
            setErrors(prev => prev.filter(e => e.id !== id))
        } catch (e) {
            console.error("Failed to delete", e)
            alert("Failed to action: " + String(e))
        } finally {
            setDeleting(null)
        }
    }

    const openFile = async (path: string) => {
        // @ts-ignore
        await window.ipcRenderer.invoke('shell:showItemInFolder', path)
    }

    return (
        <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed inset-4 md:inset-20 bg-gray-900 rounded-xl border border-red-900/50 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in">

                    {/* Header */}
                    <div className="flex-none p-4 border-b border-gray-800 flex items-center justify-between text-white bg-gray-900/50 backdrop-blur">
                        <Dialog.Title className="text-xl font-semibold flex items-center gap-2">
                            <span className="text-red-500">⚠️</span>
                            Scan Warnings
                            <span className="text-sm font-normal text-gray-400 ml-2">
                                ({errors.length} issues)
                            </span>
                        </Dialog.Title>
                        <button onClick={onClose} className="text-gray-400 hover:text-white">Close</button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-0">
                        {loading ? (
                            <div className="flex items-center justify-center h-full p-20">
                                <div className="animate-spin h-8 w-8 border-4 border-red-500 border-t-transparent rounded-full" />
                            </div>
                        ) : errors.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-20">
                                <span className="text-4xl mb-4">✅</span>
                                <p>No warnings found.</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-800/50 text-gray-400 font-medium border-b border-gray-800">
                                    <tr>
                                        <th className="p-3">File</th>
                                        <th className="p-3">Error</th>
                                        <th className="p-3">Stage</th>
                                        <th className="p-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {errors.map(err => (
                                        <tr key={err.id} className="hover:bg-gray-800/30 transition-colors group">
                                            <td className="p-3 max-w-[200px] truncate text-gray-300" title={err.file_path}>
                                                <div className="font-mono text-xs opacity-70 mb-1">{err.file_path.split(/[/\\]/).pop()}</div>
                                                <div className="text-[10px] text-gray-500 truncate">{err.file_path}</div>
                                            </td>
                                            <td className="p-3 text-red-300 break-words max-w-[300px]">
                                                {err.error_message}
                                            </td>
                                            <td className="p-3 text-gray-400 whitespace-nowrap">
                                                {err.stage}
                                                <div className="text-[10px] opacity-50">{new Date(err.timestamp).toLocaleString()}</div>
                                            </td>
                                            <td className="p-3 text-right whitespace-nowrap">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => openFile(err.file_path)}
                                                        className="p-1.5 text-blue-400 hover:bg-blue-900/20 rounded"
                                                        title="Show in Folder"
                                                    >
                                                        📂
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(err.id, false)}
                                                        disabled={deleting === err.id}
                                                        className="p-1.5 text-gray-400 hover:bg-gray-800 rounded"
                                                        title="Dismiss Warning (Keep File)"
                                                    >
                                                        👁️‍🗨️
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(err.id, true)}
                                                        disabled={deleting === err.id}
                                                        className="p-1.5 text-red-400 hover:bg-red-900/20 rounded"
                                                        title="Delete File Permanently"
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
