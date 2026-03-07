import { useCallback, useEffect, useState } from 'react'
import { DownloadIcon } from '@radix-ui/react-icons'

interface ErrorByStage {
    stage: string;
    count: number;
}

interface LibraryHealth {
    healthScore: number;
    errorsByStage: ErrorByStage[];
    recentErrorCount: number;
    totalErrors: number;
}

interface PoseStats {
    frontal: number;
    profile: number;
    severe: number;
    unknown: number;
    total: number;
}

interface LibraryHealthWidgetProps {
    health: LibraryHealth;
}

function getScoreColor(score: number): string {
    if (score >= 90) return 'text-green-400';
    if (score >= 70) return 'text-yellow-400';
    return 'text-red-400';
}

function getScoreRingColor(score: number): string {
    if (score >= 90) return '#4ade80';
    if (score >= 70) return '#facc15';
    return '#f87171';
}

function formatStageName(stage: string): string {
    return stage
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

export default function LibraryHealthWidget({ health }: LibraryHealthWidgetProps) {
    const { healthScore, errorsByStage, recentErrorCount, totalErrors } = health;
    const [poseStats, setPoseStats] = useState<PoseStats | null>(null);

    useEffect(() => {
        window.ipcRenderer.invoke('db:getPoseStatistics').then((res: any) => {
            if (res.success && res.total > 0) setPoseStats(res);
        }).catch(() => { /* non-critical — widget renders without it */ });
    }, []);

    const handleExportCsv = useCallback(async () => {
        try {
            const res = await window.ipcRenderer.invoke('dashboard:getLibraryHealth');
            if (!res.success) return;

            const rows = [['Stage', 'Error Count']];
            for (const { stage, count } of res.data.errorsByStage) {
                rows.push([stage, String(count)]);
            }
            rows.push(['', '']);
            rows.push(['Total Errors', String(res.data.totalErrors)]);
            rows.push(['Health Score', `${res.data.healthScore}%`]);
            rows.push(['Recent Errors (7d)', String(res.data.recentErrorCount)]);

            const csv = rows.map(r => r.join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'library-health-report.csv';
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to export health CSV:', err);
        }
    }, []);

    // SVG ring gauge
    const radius = 28;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (healthScore / 100) * circumference;

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Library Health</h3>
                <button
                    onClick={handleExportCsv}
                    className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                    title="Export health report as CSV"
                >
                    <DownloadIcon className="w-4 h-4" />
                </button>
            </div>

            <div className="flex items-center gap-6 mb-4">
                {/* Score ring */}
                <div className="relative flex-shrink-0">
                    <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
                        <circle cx="36" cy="36" r={radius} fill="none" stroke="#374151" strokeWidth="6" />
                        <circle
                            cx="36" cy="36" r={radius}
                            fill="none"
                            stroke={getScoreRingColor(healthScore)}
                            strokeWidth="6"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-lg font-bold ${getScoreColor(healthScore)}`}>
                            {healthScore}%
                        </span>
                    </div>
                </div>

                {/* Summary stats */}
                <div className="flex-1 space-y-1">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Total Errors</span>
                        <span className="text-gray-200">{totalErrors.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Last 7 Days</span>
                        <span className={recentErrorCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
                            {recentErrorCount > 0 ? `+${recentErrorCount}` : 'None'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Error breakdown by stage */}
            {errorsByStage.length > 0 && (
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Errors by Stage</label>
                    {errorsByStage.slice(0, 5).map(({ stage, count }) => (
                        <div key={stage} className="flex justify-between text-sm py-0.5">
                            <span className="text-gray-400 truncate mr-2">{formatStageName(stage)}</span>
                            <span className="text-gray-300 flex-shrink-0">{count.toLocaleString()}</span>
                        </div>
                    ))}
                    {errorsByStage.length > 5 && (
                        <p className="text-xs text-gray-500">+{errorsByStage.length - 5} more stages</p>
                    )}
                </div>
            )}

            {errorsByStage.length === 0 && totalErrors === 0 && (
                <p className="text-sm text-green-400">No errors detected. Your library is healthy!</p>
            )}

            {poseStats && (
                <div className="mt-4 pt-4 border-t border-gray-700">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Face Pose Distribution</label>
                    <div className="mt-2 flex rounded overflow-hidden h-3" title={`Frontal: ${poseStats.frontal} · Profile: ${poseStats.profile} · Severe: ${poseStats.severe} · Unknown: ${poseStats.unknown}`}>
                        {poseStats.frontal > 0 && (
                            <div className="bg-green-500" style={{ width: `${(poseStats.frontal / poseStats.total) * 100}%` }} />
                        )}
                        {poseStats.profile > 0 && (
                            <div className="bg-yellow-400" style={{ width: `${(poseStats.profile / poseStats.total) * 100}%` }} />
                        )}
                        {poseStats.severe > 0 && (
                            <div className="bg-red-400" style={{ width: `${(poseStats.severe / poseStats.total) * 100}%` }} />
                        )}
                        {poseStats.unknown > 0 && (
                            <div className="bg-gray-600" style={{ width: `${(poseStats.unknown / poseStats.total) * 100}%` }} />
                        )}
                    </div>
                    <div className="flex gap-3 mt-1.5 flex-wrap">
                        {[
                            { label: 'Frontal', count: poseStats.frontal, color: 'text-green-400' },
                            { label: 'Profile', count: poseStats.profile, color: 'text-yellow-400' },
                            { label: 'Severe', count: poseStats.severe, color: 'text-red-400' },
                            { label: 'Unknown', count: poseStats.unknown, color: 'text-gray-400' },
                        ].filter(s => s.count > 0).map(({ label, count, color }) => (
                            <span key={label} className="text-xs text-gray-500">
                                <span className={`font-medium ${color}`}>{label}</span> {count.toLocaleString()}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
