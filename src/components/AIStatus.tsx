import React from 'react'
import { useAI } from '../context/AIContext'

export default function AIStatus() {
    const { processingQueue } = useAI()

    if (processingQueue.length === 0) return null

    return (
        <div className="flex items-center gap-2 px-3 py-1 bg-indigo-900/40 rounded-full border border-indigo-500/30">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs text-indigo-200 font-medium">
                AI: {processingQueue.length}
            </span>
        </div>
    )
}
