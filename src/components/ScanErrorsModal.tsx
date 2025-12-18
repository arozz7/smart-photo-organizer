import { useScan } from '../context/ScanContext'

interface ScanErrorsModalProps {
    onClose: () => void
}

export default function ScanErrorsModal({ onClose }: ScanErrorsModalProps) {
    const { scanErrors, retryErrors, clearErrors } = useScan()

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-gray-700">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h3 className="text-lg font-semibold text-red-400 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        Scan Errors ({scanErrors.length})
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {scanErrors.length === 0 ? (
                        <div className="text-center text-gray-500 py-8">No errors found.</div>
                    ) : (
                        scanErrors.map((err: any) => (
                            <div key={err.id} className="bg-gray-900/50 p-3 rounded border border-gray-700/50 flex flex-col gap-1">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="text-sm font-medium text-gray-200 break-all">{err.file_path}</div>
                                    <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded shrink-0">{err.stage}</span>
                                </div>
                                <div className="text-xs text-red-300 font-mono bg-black/20 p-1 rounded overflow-x-auto">
                                    {err.error_message}
                                </div>
                                <div className="text-xs text-gray-500 text-right">
                                    {new Date(err.timestamp).toLocaleString()}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-gray-700 flex justify-end gap-3 bg-gray-800 rounded-b-lg">
                    <button
                        onClick={clearErrors}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
                    >
                        Clear List
                    </button>
                    <button
                        onClick={() => {
                            retryErrors()
                            onClose()
                        }}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm transition-colors font-medium flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Retry All
                    </button>
                </div>
            </div>
        </div>
    )
}
