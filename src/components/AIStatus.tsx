import { useAI } from '../context/AIContext'

export default function AIStatus() {
    const { processingQueue, isPaused, isCoolingDown, cooldownTimeLeft } = useAI()

    if (processingQueue.length === 0 && !isCoolingDown) return null

    if (isCoolingDown) {
        return (
            <div className="flex items-center gap-2 px-3 py-0.5 bg-orange-900/30 rounded border border-orange-500/30 text-orange-200">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-medium">
                    Cooling Down ({cooldownTimeLeft}s)
                </span>
            </div>
        )
    }

    if (isPaused) {
        return (
            <div className="flex items-center gap-2 px-3 py-0.5 bg-yellow-900/30 rounded border border-yellow-500/30 text-yellow-200">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-medium">
                    AI Paused ({processingQueue.length})
                </span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2 px-3 py-0.5 bg-indigo-900/30 rounded border border-indigo-500/30 text-indigo-200">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs font-medium">
                AI Processing ({processingQueue.length})
            </span>
        </div>
    )
}

