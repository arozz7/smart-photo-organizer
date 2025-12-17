import { useAI } from '../context/AIContext'
import { useState } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useAlert } from '../context/AlertContext'

export default function Queues() {
    const {
        processingQueue,
        isPaused,
        setIsPaused,
        queueConfig,
        setQueueConfig,
        isCoolingDown,
        cooldownTimeLeft,
        skipCooldown,
        addToQueue,
        systemStatus,
        fetchSystemStatus
    } = useAI()
    const { rebuildIndex } = usePeople()
    const { showAlert } = useAlert()

    const [recovering, setRecovering] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const handleBatchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value) || 0
        setQueueConfig({ ...queueConfig, batchSize: val })
    }

    const handleCooldownChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value) || 0
        setQueueConfig({ ...queueConfig, cooldownSeconds: val })
    }

    return (
        <div className="p-8 h-full overflow-y-auto bg-gray-900 text-gray-100">
            <h2 className="text-3xl font-bold mb-8 text-white">Queue Management</h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* AI Queue Control Panel */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 space-y-6">
                    <div className="flex justify-between items-start">
                        <h3 className="text-xl font-semibold text-indigo-400">AI Processing Queue</h3>
                        <div className="px-3 py-1 rounded-full text-xs font-bold bg-gray-900 border border-gray-700">
                            {processingQueue.length} Pending
                        </div>
                    </div>

                    {/* Status Display */}
                    <div className="bg-gray-900/50 rounded p-4 flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-400">Status</div>
                            <div className="text-lg font-medium flex items-center gap-2">
                                {isCoolingDown ? (
                                    <span className="text-orange-400 flex items-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Cooling Down ({cooldownTimeLeft}s)
                                    </span>
                                ) : isPaused ? (
                                    <span className="text-yellow-500 flex items-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                        Paused
                                    </span>
                                ) : processingQueue.length > 0 ? (
                                    <span className="text-green-400 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                        Running
                                    </span>
                                ) : (
                                    <span className="text-gray-500">Idle</span>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {isCoolingDown && (
                                <button
                                    onClick={skipCooldown}
                                    className="px-3 py-1 bg-orange-900/50 text-orange-200 text-sm rounded hover:bg-orange-800/50 border border-orange-700/50"
                                >
                                    Skip Wait
                                </button>
                            )}
                            <button
                                onClick={() => setIsPaused(!isPaused)}
                                className={`px-4 py-2 rounded font-medium transition-colors border ${isPaused
                                    ? 'bg-green-600 hover:bg-green-500 text-white border-green-500'
                                    : 'bg-yellow-600 hover:bg-yellow-500 text-white border-yellow-500'
                                    }`}
                            >
                                {isPaused ? 'Resume' : 'Pause'}
                            </button>
                        </div>
                    </div>

                    {/* GPU Protection Config */}
                    <div className="space-y-4 pt-4 border-t border-gray-700">
                        <h4 className="font-medium text-white flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-pink-500" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                            </svg>
                            GPU Protection
                        </h4>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Batch Size (Photos)</label>
                                <input
                                    type="number"
                                    value={queueConfig.batchSize}
                                    onChange={handleBatchChange}
                                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                                    placeholder="0 (Unlimited)"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">Set to 0 for continuous.</p>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Cooldown (Seconds)</label>
                                <input
                                    type="number"
                                    value={queueConfig.cooldownSeconds}
                                    onChange={handleCooldownChange}
                                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Pending Items List */}
                    <div className="flex-1 min-h-[200px] border rounded border-gray-700 bg-gray-900/30 overflow-hidden flex flex-col">
                        <div className="bg-gray-700 px-4 py-2 text-xs font-semibold text-gray-300">
                            Next Up
                        </div>
                        <div className="overflow-y-auto flex-1 p-2 space-y-1">
                            {processingQueue.slice(0, 50).map((p, i) => (
                                <div key={p.id} className="text-xs text-gray-400 truncate border-b border-gray-800/50 pb-1 flex gap-2">
                                    <span className="text-gray-600 font-mono w-6 text-right">{i + 1}.</span>
                                    {p.file_path || `Photo #${p.id}`}
                                </div>
                            ))}
                            {processingQueue.length > 50 && (
                                <div className="text-xs text-center text-gray-500 py-2">
                                    ... and {processingQueue.length - 50} more
                                </div>
                            )}
                            {processingQueue.length === 0 && (
                                <div className="h-full flex items-center justify-center text-gray-600 text-sm italic">
                                    Queue is empty
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Info / Help */}
                <div className="space-y-6">
                    <div className="bg-blue-900/20 border border-blue-800 rounded p-4 text-sm text-blue-200">
                        <h4 className="font-bold flex items-center gap-2 mb-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            Usage Tips
                        </h4>
                        <p className="mb-2">
                            Use <strong>Batch Size</strong> to limit how many photos are processed before taking a break.
                        </p>
                        <p>
                            Use <strong>Cooldown</strong> to specify how long the system should wait between batches to allow your GPU to cool down.
                        </p>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-white">System Status</h3>
                            {systemStatus?.system?.cuda_available ? (
                                <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-400 border border-green-700">
                                    CUDA: {systemStatus.system.cuda_device}
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded text-xs font-bold bg-gray-700 text-gray-400">
                                    CPU Mode
                                </span>
                            )}
                        </div>

                        {!systemStatus ? (
                            <div className="text-sm text-gray-500 animate-pulse">Loading status...</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">

                                {/* AI Engine */}
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">AI Engine (InsightFace)</h4>
                                    <div className="space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Status</span>
                                            <span className={systemStatus.insightface.loaded ? "text-green-400" : "text-red-400"}>
                                                {systemStatus.insightface.loaded ? "Active" : "Failed"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Provider</span>
                                            <span className="text-gray-200">{systemStatus.insightface.providers?.[0] || 'Unknown'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Detection Thresh</span>
                                            <span className="text-gray-200">{systemStatus.insightface.det_thresh}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Vector DB */}
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Vector DB (FAISS)</h4>
                                    <div className="space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Status</span>
                                            <span className={systemStatus.faiss.loaded ? "text-green-400" : "text-red-400"}>
                                                {systemStatus.faiss.loaded ? "Ready" : "Not Loaded"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Vectors</span>
                                            <span className="text-gray-200">{systemStatus.faiss.count?.toLocaleString() || 0}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-400">Dimensions</span>
                                            <span className="text-gray-200">{systemStatus.faiss.dim || 0}</span>
                                        </div>
                                        <div className="pt-2">
                                            <button
                                                disabled={syncing}
                                                onClick={async () => {
                                                    setSyncing(true)
                                                    try {
                                                        const res = await rebuildIndex();
                                                        if (res.success) {
                                                            showAlert({
                                                                title: 'Index Synced',
                                                                description: `Successfully indexed ${res.count} face vectors.`
                                                            });
                                                            await fetchSystemStatus();
                                                        } else {
                                                            showAlert({
                                                                title: 'Sync Failed',
                                                                description: res.error || 'Unknown error',
                                                                variant: 'danger'
                                                            });
                                                        }
                                                    } finally {
                                                        setSyncing(false)
                                                    }
                                                }}
                                                className="w-full py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs transition-colors flex items-center justify-center gap-2"
                                            >
                                                {syncing ? (
                                                    <>
                                                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                        </svg>
                                                        Syncing...
                                                    </>
                                                ) : 'Sync FAISS with Database'}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* VLM */}
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Smart Vision (VLM)</h4>
                                    <div className="space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Model</span>
                                            <span className="text-gray-200">{systemStatus.vlm.model || 'None'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">State</span>
                                            <span className={systemStatus.vlm.loaded ? "text-green-400" : "text-gray-500"}>
                                                {systemStatus.vlm.loaded ? "Loaded" : "Lazy Loading..."}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Device</span>
                                            <span className="text-gray-200">{systemStatus.vlm.device || 'N/A'}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Backend */}
                                <div>
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Libraries</h4>
                                    <div className="space-y-1 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Torch</span>
                                            <span className="text-gray-500">{systemStatus.system.torch}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">ONNX Runtime</span>
                                            <span className="text-gray-500">{systemStatus.system.onnxruntime}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">OpenCV</span>
                                            <span className="text-gray-500">{systemStatus.system.opencv}</span>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        )}
                    </div>

                    {/* Scan Recovery */}
                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                        <h3 className="text-lg font-medium text-white mb-2">Queue Recovery</h3>
                        <p className="text-sm text-gray-400 mb-4">
                            If the app was restarted, the queue might appear empty even if tasks remain.
                        </p>
                        <button
                            onClick={async () => {
                                setRecovering(true);
                                try {
                                    // @ts-ignore
                                    const items = await window.ipcRenderer.invoke('db:getUnprocessedItems');
                                    if (items && items.length > 0) {
                                        addToQueue(items);
                                    }
                                } finally {
                                    setRecovering(false);
                                }
                            }}
                            disabled={recovering}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {recovering ? 'Scanning Database...' : 'Find & Clean Up Unprocessed Items'}
                        </button>
                    </div>

                </div>

            </div>
        </div>
    )
}
