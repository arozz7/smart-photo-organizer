import { useAI } from '../context/AIContext';
import { useScan } from '../context/ScanContext';

export default function StatusBar() {
    const {
        calculatingBlur,
        blurProgress,
        isModelLoading,
        isCoolingDown,
        cooldownTimeLeft,
        processingQueue,
        isThrottled
    } = useAI();
    const { scanning, scanCount } = useScan();

    // Show if ANY activity is happening
    const isActive = calculatingBlur || isModelLoading || isCoolingDown || processingQueue.length > 0 || scanning;

    if (!isActive) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900/90 backdrop-blur-md border-t border-gray-800 px-4 py-1 text-xs flex items-center justify-between z-50 shadow-up text-gray-400 h-8 select-none">
            <div className="flex items-center gap-6">
                {scanning && (
                    <span className="flex items-center gap-2 text-blue-400 font-medium animate-pulse">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Scanning Files ({scanCount})
                    </span>
                )}

                {calculatingBlur && (
                    <span className="flex items-center gap-2 text-indigo-400 font-medium">
                        <span className="animate-pulse">●</span> Blur Scores: {blurProgress.current} / {blurProgress.total}
                    </span>
                )}

                {isModelLoading && (
                    <span className="flex items-center gap-2 text-yellow-400 font-medium">
                        <span className="animate-spin">⟳</span> Loading Models
                    </span>
                )}

                {processingQueue.length > 0 && (
                    <span className="flex items-center gap-2 text-green-400 font-medium">
                        <span className="animate-pulse">●</span> AI Queue: {processingQueue.length}
                    </span>
                )}

                {isCoolingDown && (
                    <span className="flex items-center gap-2 text-orange-400 font-medium">
                        <span className="animate-pulse">●</span> Cooling: {cooldownTimeLeft}s
                    </span>
                )}
            </div>

            <div className="flex items-center gap-4">
                {isThrottled && (
                    <span className="flex items-center gap-1.5 text-yellow-500/80 font-medium" title="Background processing slowed down to keep UI responsive">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Performance Mode
                    </span>
                )}
            </div>
        </div>
    );
}
