/**
 * RematchCard
 *
 * Unassigned faces are matched against the people the user has named, again, because people named after a face was first
 * processed never got a look at it. Matches are assigned unconfirmed (reviewed on the person's page) and can be undone.
 * The match distance (default 0.65) is its own setting here, not the Face Similarity Threshold. See docs/plans/review-queue-parking-plan.md, Phase 2.
 */

import { useRematch } from '../hooks/useRematch'

/** Choices for the match distance (the service accepts 0.4 to 0.8). */
const DISTANCES = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]

export function RematchCard() {
    const { status, message, run, undo, setAuto, setDistance } = useRematch()
    const percent = status && status.total > 0 ? Math.min(100, Math.round((status.checked / status.total) * 100)) : 0

    return (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
                <div className="max-w-xl">
                    <h3 className="font-medium text-white">Re-match Unassigned Faces</h3>
                    <p className="text-sm text-gray-400">
                        Compares unassigned faces with the people you have named, including people named after the faces were scanned.
                        Matches are assigned <em>unconfirmed</em>: review them on the person's page (Unconfirmed filter), confirm or remove them, or undo them all here.
                        A face matches when it is within the distance below of a named person; smaller is stricter.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => void run()}
                        disabled={!status || status.running}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    >
                        {status?.running ? 'Running...' : 'Run now'}
                    </button>
                    <button
                        onClick={() => void undo()}
                        disabled={!status || status.running || status.undoable === 0}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    >
                        Undo re-match{status && status.undoable > 0 ? ` (${status.undoable.toLocaleString()})` : ''}
                    </button>
                </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                Match distance
                <select
                    value={status?.threshold ?? 0.65}
                    disabled={!status || status.running}
                    onChange={event => void setDistance(Number(event.target.value))}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white"
                >
                    {DISTANCES.map(distance => (
                        <option key={distance} value={distance}>
                            {distance.toFixed(2)}{distance === 0.65 ? ' (default)' : ''}
                        </option>
                    ))}
                </select>
                <span className="text-xs text-gray-500">Used by the next run (locked while a run is under way).</span>
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-300 mb-3">
                <input
                    type="checkbox"
                    checked={status?.autoEnabled ?? true}
                    disabled={!status}
                    onChange={event => void setAuto(event.target.checked)}
                />
                Run automatically when no scan is running, after the named people or the distance change
            </label>

            {status?.running && (
                <div className="mb-3">
                    <div className="h-2 bg-black/30 rounded overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="text-sm text-indigo-300 mt-1">
                        {status.checked.toLocaleString()} of {status.total.toLocaleString()} faces checked, {status.matched.toLocaleString()} matched so far.
                        It pauses while a scan or AI work is running.
                    </p>
                </div>
            )}

            {message && <p className="text-sm text-amber-300 mb-2">{message}</p>}

            {status && !status.running && (
                <p className="text-xs text-gray-500">
                    {status.lastRun
                        ? status.lastRun.error
                            ? `Last run ${new Date(status.lastRun.completedAt).toLocaleString()} stopped by an error: ${status.lastRun.error}`
                            : `Last run ${new Date(status.lastRun.completedAt).toLocaleString()}: ${status.lastRun.matched.toLocaleString()} of ${status.lastRun.checked.toLocaleString()} unassigned faces matched a named person.`
                        : 'Has not run yet.'}
                </p>
            )}
        </div>
    )
}
