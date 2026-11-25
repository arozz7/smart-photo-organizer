import { useState, useEffect, useRef } from 'react'
import { useScan } from '../../context/ScanContext'
import { useAI } from '../../context/AIContext'
import { useScanProgress } from '../../hooks/useScanProgress'
import { describeScanProgress, scanPercent } from '../../utils/scanProgress'

interface ScanEntertainmentWidgetProps {
    memories: any[];
}

export default function ScanEntertainmentWidget({ memories }: ScanEntertainmentWidgetProps) {
    const { scanning } = useScan();
    const { progress, elapsedMs } = useScanProgress(scanning);
    const { isProcessing, processingQueue, scanMetrics } = useAI();
    const [flashbackIndex, setFlashbackIndex] = useState(0);
    const [showWidget, setShowWidget] = useState(false);
    const flashbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const isActive = scanning || isProcessing;

    // Show widget when scanning starts, keep visible for 30s after completion
    useEffect(() => {
        if (isActive) {
            setShowWidget(true);
        } else if (showWidget) {
            const timeout = setTimeout(() => setShowWidget(false), 30000);
            return () => clearTimeout(timeout);
        }
    }, [isActive, showWidget]);

    // Rotate flashback every 10 seconds
    useEffect(() => {
        if (!showWidget || memories.length === 0) return;

        flashbackTimerRef.current = setInterval(() => {
            setFlashbackIndex(prev => (prev + 1) % memories.length);
        }, 10000);

        return () => {
            if (flashbackTimerRef.current) clearInterval(flashbackTimerRef.current);
        };
    }, [showWidget, memories.length]);

    if (!showWidget) return null;

    const flashbackPhoto = memories.length > 0 ? memories[flashbackIndex] : null;
    const queueSize = processingQueue.length;
    const avgTime = scanMetrics ? `${(scanMetrics.total / 1000).toFixed(1)}s/photo` : null;

    return (
        <div className="bg-gray-800 rounded-lg border border-indigo-500/30 p-6 ring-1 ring-indigo-500/20">
            <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <h3 className="text-lg font-semibold text-white">
                    {isActive ? 'Scanning in Progress' : 'Scan Complete'}
                </h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
                {/* Live Stats */}
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                        <StatBadge label="Photos Scanned" value={progress?.done ?? 0} color="text-blue-400" />
                        <StatBadge label="AI Queue" value={queueSize} color="text-amber-400" />
                    </div>

                    {/* Always present (empty until the file list is known) so the widget keeps its height */}
                    <div className="space-y-1">
                        <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden" role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={progress?.total ?? 0} aria-valuenow={progress?.done ?? 0}>
                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${scanPercent(progress)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-500 truncate min-h-[1rem]">{isActive && progress ? describeScanProgress(progress, elapsedMs) : ''}</p>
                    </div>

                    {/* These rows are always there (with a dash until known): rows that come and go change the widget's height and push every card below it */}
                    <div className="grid grid-cols-2 gap-2">
                        <StatBadge
                            label="Faces Found"
                            value={scanMetrics && scanMetrics.scan > 0 ? `${Math.round(scanMetrics.scan)}ms` : '—'}
                            color="text-green-400"
                        />
                        <StatBadge label="Avg Speed" value={avgTime ?? '—'} color="text-purple-400" />
                    </div>

                    <p className={`text-xs text-gray-400 mt-2 ${isActive ? 'invisible' : ''}`}>
                        Scan finished! This panel will hide shortly.
                    </p>
                </div>

                {/* Random Flashback */}
                <div>
                    {flashbackPhoto ? (
                        <div className="relative rounded-md overflow-hidden bg-gray-900">
                            <img
                                src={`local-resource://${encodeURIComponent(flashbackPhoto.preview_cache_path || flashbackPhoto.file_path)}?width=300`}
                                alt=""
                                className="w-full h-32 object-cover transition-opacity duration-700"
                                loading="lazy"
                                decoding="async"
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                                <span className="text-xs text-gray-200">
                                    Memory from {flashbackPhoto.year}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-32 bg-gray-900 rounded-md">
                            <p className="text-xs text-gray-500">Scanning your library...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatBadge({ label, value, color }: { label: string; value: string | number; color: string }) {
    return (
        <div className="bg-gray-900/50 rounded-md px-3 py-2">
            <div className={`text-sm font-bold ${color}`}>{value}</div>
            <div className="text-[10px] text-gray-500">{label}</div>
        </div>
    );
}
