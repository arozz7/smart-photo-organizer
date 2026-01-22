/**
 * AgeBackfillCard Component (Phase 42)
 * 
 * UI card for triggering and monitoring age data backfill.
 * Displayed in Settings or Tools section.
 */

import { useAgeBackfill } from '../hooks/useAgeBackfill';

export function AgeBackfillCard() {
    const {
        status,
        isLoading,
        isActive,
        needsBackfill,
        startBackfill,
        cancelBackfill
    } = useAgeBackfill();

    const handleStart = async () => {
        const result = await startBackfill();
        if (!result.success && result.error) {
            console.error('Failed to start age backfill:', result.error);
        }
    };

    const handleCancel = async () => {
        await cancelBackfill();
    };

    // No faces need backfill
    if (!needsBackfill && !isActive) {
        return (
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                        <span className="text-green-400">✓</span>
                    </div>
                    <div>
                        <h3 className="font-medium text-white">Age Data Complete</h3>
                        <p className="text-sm text-gray-400">
                            All named faces have age estimates
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                        <span className="text-indigo-400">⏱</span>
                    </div>
                    <div>
                        <h3 className="font-medium text-white">Age Data Backfill</h3>
                        <p className="text-sm text-gray-400">
                            Extract age estimates for existing faces
                        </p>
                    </div>
                </div>

                {!isActive ? (
                    <button
                        onClick={handleStart}
                        disabled={isLoading}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 text-sm font-medium"
                    >
                        ▶ Start
                    </button>
                ) : (
                    <button
                        onClick={handleCancel}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium"
                    >
                        ■ Cancel
                    </button>
                )}
            </div>

            {/* Progress Display */}
            {(isActive || (status && status.total > 0)) && (
                <div className="mt-3">
                    <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">
                            {isActive ? 'Processing...' : 'Pending'}
                        </span>
                        <span className="text-white font-mono">
                            {status?.processed ?? 0} / {status?.total ?? 0} faces
                        </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                            className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${status?.percentage ?? 0}%` }}
                        />
                    </div>
                    {status?.remaining && status.remaining > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                            {status.remaining} faces remaining
                        </p>
                    )}
                </div>
            )}

            {/* Info */}
            {!isActive && needsBackfill && (
                <p className="text-xs text-gray-500 mt-3">
                    This will extract age data for {status?.remaining ?? 0} named faces.
                    ERAs will be auto-generated when complete.
                </p>
            )}
        </div>
    );
}
