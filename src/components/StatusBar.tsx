import { useAI } from '../context/AIContext';
import { useScan } from '../context/ScanContext';

export default function StatusBar() {
    const { calculatingBlur, blurProgress, isModelLoading, isCoolingDown, cooldownTimeLeft, processingQueue } = useAI();
    // @ts-ignore
    const { scanning } = useScan ? useScan() : { scanning: false };

    // Show if ANY activity is happening
    const isActive = calculatingBlur || isModelLoading || isCoolingDown || processingQueue.length > 0 || scanning;

    if (!isActive) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-4 py-1 text-xs flex items-center justify-between z-50 shadow-up text-gray-400 h-8">
            <div className="flex items-center gap-6">
                {scanning && (
                    <span className="flex items-center gap-2 text-blue-400 font-medium">
                        <span className="animate-pulse">●</span> Scanning
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
        </div>
    );
}
