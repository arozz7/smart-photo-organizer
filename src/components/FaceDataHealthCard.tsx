/**
 * FaceDataHealthCard Component
 * 
 * Unified UI showing per-field completion percentages for face data
 * (age, gender, pose, embeddings) with one-click upgrade capability.
 * 
 * Powered by FaceDataUpgradeService (Backend) for persistence.
 */

import { useState, useEffect, useCallback } from 'react';
import { useFaceDataUpgrade } from '../hooks/useFaceDataUpgrade';

interface FaceDataHealth {
    total: number;
    eligibleTotal: number;
    withAge: number;
    withGender: number;
    withPose: number;
    withDescriptorV2: number;
    agePercent: number;
    genderPercent: number;
    posePercent: number;
    descriptorV2Percent: number;
}

function ProgressBar({ label, percent }: { label: string; percent: number }) {
    const isComplete = percent >= 100;
    const barColor = isComplete ? 'bg-green-500' : percent > 50 ? 'bg-indigo-500' : 'bg-amber-500';

    return (
        <div className="flex items-center gap-3">
            <span className="w-24 text-sm text-gray-300 truncate">{label}</span>
            <div className="flex-1 bg-gray-700 rounded-full h-2.5 relative">
                <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.min(percent, 100)}%` }}
                />
            </div>
            <span className="w-12 text-right text-sm font-mono text-gray-400">
                {percent}%
            </span>
            {isComplete && (
                <span className="text-green-400 text-sm">✓</span>
            )}
        </div>
    );
}

export function FaceDataHealthCard() {
    const [health, setHealth] = useState<FaceDataHealth | null>(null);
    const { status, isRunning, isPaused, start, stop, pause, resume } = useFaceDataUpgrade();

    // Fetch global database health stats
    const fetchHealth = useCallback(async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getFaceDataHealth');
            if (result.success) {
                setHealth(result);
            }
        } catch (e) {
            console.error('[FaceDataHealthCard] Failed to fetch health:', e);
        }
    }, []);

    useEffect(() => {
        fetchHealth();
    }, [fetchHealth]);

    // Refresh health stats periodically ONLY if actively running (not paused)
    // The query is expensive (6 COUNT queries on 65k+ faces), so we poll less frequently
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRunning && !isPaused) {
            interval = setInterval(fetchHealth, 10000); // Poll every 10s while ACTIVELY running
        }
        return () => clearInterval(interval);
    }, [isRunning, isPaused, fetchHealth]);

    // Calculate what needs upgrading
    const needsUpgrade = health && (health.posePercent < 100 || health.descriptorV2Percent < 100);

    if (!health) {
        return (
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <p className="text-gray-400 text-sm">Loading face data health...</p>
            </div>
        );
    }

    // All complete state (only if not running)
    if (!needsUpgrade && !isRunning) {
        return (
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                        <span className="text-green-400 text-lg">✓</span>
                    </div>
                    <div>
                        <h3 className="font-medium text-white">Face Data Complete</h3>
                        <p className="text-sm text-gray-400">
                            All eligible faces ({health.eligibleTotal.toLocaleString()}) have complete data
                        </p>
                    </div>
                </div>
                <div className="space-y-2">
                    <ProgressBar label="Age" percent={health.agePercent} />
                    <ProgressBar label="Gender" percent={health.genderPercent} />
                    <ProgressBar label="Pose" percent={health.posePercent} />
                    <ProgressBar label="Embeddings" percent={health.descriptorV2Percent} />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                        <span className="text-indigo-400 text-lg">⚙</span>
                    </div>
                    <div>
                        <h3 className="font-medium text-white">Face Data Health</h3>
                        <p className="text-sm text-gray-400">
                            {health.eligibleTotal.toLocaleString()} eligible faces
                        </p>
                    </div>
                </div>

                {/* Controls */}
                {!isRunning ? (
                    <button
                        onClick={start}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                    >
                        ▶ Upgrade Missing
                    </button>
                ) : (
                    <div className="flex gap-2">
                        <button
                            onClick={isPaused ? resume : pause}
                            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium border border-gray-600"
                        >
                            {isPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                            onClick={stop}
                            className="px-3 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-200 rounded-lg text-sm font-medium border border-red-800/50"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>

            {/* Progress bars */}
            <div className="space-y-2 mb-4">
                <ProgressBar label="Age" percent={health.agePercent} />
                <ProgressBar label="Gender" percent={health.genderPercent} />
                <ProgressBar label="Pose" percent={health.posePercent} />
                <ProgressBar label="Embeddings" percent={health.descriptorV2Percent} />
            </div>

            {/* Processing status */}
            {isRunning && status && (
                <div className="bg-black/30 rounded p-3">
                    <div className="flex justify-between text-sm mb-1">
                        <span className={`text-indigo-400 ${isPaused ? '' : 'animate-pulse'}`}>
                            {isPaused ? 'PAUSED' : 'Processing...'}
                        </span>
                        <span className="text-white font-mono">
                            {status.percentage}% ({status.processed} / {status.total})
                        </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                            className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${status.percentage}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
