/**
 * FaceVisibilityCard
 *
 * Asks the vision model whether a clear face is visible in the faces the detector was unsure about (a few at a time, on the
 * GPU, only when the user is away unless chosen otherwise). The answers improve Edge Cases > Not a Face?; the check itself
 * never ignores or changes a face. See docs/plans/non-face-and-picture-faces-plan.md, Phase B part 2.
 */

import { useFaceVisibility, type RunMode } from '../hooks/useFaceVisibility'
import { describeState } from '../utils/visibilityText'

const MODES: { value: RunMode; label: string }[] = [
    { value: 'away', label: 'Only when I am away' },
    { value: 'always', label: 'Whenever no scan or AI work is running' },
    { value: 'off', label: 'Off' },
]

/** Choices for how long without keyboard or mouse input counts as "away" (the service accepts 1 to 60 minutes). */
const AWAY_MINUTES = [1, 2, 5, 10, 15, 30, 60]

export function FaceVisibilityCard() {
    const { status, message, runNow, setMode, setAwayMinutes } = useFaceVisibility()
    const checked = status ? status.scored + status.failed : 0
    const percent = status && status.candidates > 0 ? Math.min(100, Math.round((checked / status.candidates) * 100)) : 0

    return (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
                <div className="max-w-xl">
                    <h3 className="font-medium text-white">Check Uncertain Faces</h3>
                    <p className="text-sm text-gray-400">
                        Asks the vision model whether a clear face is visible in the faces the detector was unsure about, and uses the answers to improve
                        <em> People &gt; Edge Cases &gt; Not a Face?</em>. It only ranks suggestions: nothing is ignored or changed by it.
                        It uses the GPU (well under a second a face) and pauses for scans and AI work.
                    </p>
                </div>
                <button
                    onClick={() => void runNow()}
                    disabled={!status || status.state === 'scoring' || status.remaining === 0}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                >
                    {status?.state === 'scoring' ? 'Checking...' : 'Run now'}
                </button>
            </div>

            <div className="flex items-center gap-4 flex-wrap mb-3 text-sm text-gray-300">
                <label className="flex items-center gap-2">
                    Run
                    <select
                        aria-label="When to run"
                        value={status?.mode ?? 'away'}
                        disabled={!status}
                        onChange={event => void setMode(event.target.value as RunMode)}
                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white"
                    >
                        {MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                </label>
                {status?.mode === 'away' && (
                    <label className="flex items-center gap-2">
                        Away means no keyboard or mouse input for
                        <select
                            aria-label="Minutes away"
                            value={status.awayMinutes}
                            onChange={event => void setAwayMinutes(Number(event.target.value))}
                            className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white"
                        >
                            {AWAY_MINUTES.map(minutes => <option key={minutes} value={minutes}>{minutes} {minutes === 1 ? 'minute' : 'minutes'}</option>)}
                        </select>
                    </label>
                )}
            </div>

            {status && status.candidates > 0 && (
                <div className="mb-3">
                    <div className="h-2 bg-black/30 rounded overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="text-sm text-indigo-300 mt-1">
                        {checked.toLocaleString()} of {status.candidates.toLocaleString()} uncertain faces checked
                        {status.failed > 0 ? ` (${status.failed.toLocaleString()} could not be read)` : ''}.
                    </p>
                </div>
            )}

            {status && <p className="text-xs text-gray-400">{describeState(status)}</p>}
            {message && <p className="text-sm text-amber-300 mt-2">{message}</p>}
        </div>
    )
}
