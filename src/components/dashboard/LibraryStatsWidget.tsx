interface DashboardStats {
    totalPhotos: number;
    processed: number;
    pending: number;
    errorCount: number;
    namedPeople: number;
    totalFaces: number;
    unassignedFaces: number;
}

interface LibraryStatsWidgetProps {
    stats: DashboardStats;
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
    return (
        <div className="bg-gray-900/50 rounded-md p-3 text-center">
            <div className={`text-xl font-bold ${color || 'text-white'}`}>
                {typeof value === 'number' ? value.toLocaleString() : value}
            </div>
            <div className="text-xs text-gray-400 mt-1">{label}</div>
        </div>
    );
}

export default function LibraryStatsWidget({ stats }: LibraryStatsWidgetProps) {
    const { totalPhotos, processed, pending, errorCount, namedPeople, totalFaces, unassignedFaces } = stats;

    // Conic gradient pie chart segments
    const total = processed + pending + errorCount;
    const processedPct = total > 0 ? (processed / total) * 100 : 0;
    const pendingPct = total > 0 ? (pending / total) * 100 : 0;
    // errorPct fills the rest

    const processedEnd = processedPct;
    const pendingEnd = processedEnd + pendingPct;

    const gradient = total > 0
        ? `conic-gradient(
            #22c55e 0% ${processedEnd}%,
            #f59e0b ${processedEnd}% ${pendingEnd}%,
            #ef4444 ${pendingEnd}% 100%
        )`
        : 'conic-gradient(#374151 0% 100%)';

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Library Stats</h3>

            {totalPhotos === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-gray-500">
                    <span className="text-3xl mb-3">📊</span>
                    <p className="text-sm">No photos yet. Start scanning!</p>
                </div>
            ) : (
                <>
                    {/* Pie chart */}
                    <div className="flex items-center justify-center mb-4">
                        <div className="relative">
                            <div
                                className="w-28 h-28 rounded-full"
                                style={{ background: gradient }}
                            />
                            {/* Inner circle for donut effect */}
                            <div className="absolute inset-3 bg-gray-800 rounded-full flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-lg font-bold text-white">{totalPhotos.toLocaleString()}</div>
                                    <div className="text-[10px] text-gray-400">photos</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex justify-center gap-4 mb-4 text-xs">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                            <span className="text-gray-300">Processed ({processed.toLocaleString()})</span>
                        </div>
                        {pending > 0 && (
                            <div className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                                <span className="text-gray-300">Pending ({pending})</span>
                            </div>
                        )}
                        {errorCount > 0 && (
                            <div className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                <span className="text-gray-300">Errors ({errorCount})</span>
                            </div>
                        )}
                    </div>

                    {/* Stat cards */}
                    <div className="grid grid-cols-3 gap-2">
                        <StatCard label="People" value={namedPeople} color="text-indigo-400" />
                        <StatCard label="Faces" value={totalFaces} />
                        <StatCard label="Unassigned" value={unassignedFaces} color="text-amber-400" />
                    </div>
                </>
            )}
        </div>
    );
}
