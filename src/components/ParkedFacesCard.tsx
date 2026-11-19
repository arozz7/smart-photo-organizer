/**
 * ParkedFacesCard
 *
 * Read-only summary of how many unassigned faces are worth reviewing and how many would be "parked":
 * too small or blurry to recognise, or appearing only once with nobody named near them.
 * Nothing is ignored, assigned or deleted by this card. See docs/plans/review-queue-parking-plan.md.
 */

import { useParkedSummary } from '../hooks/useParkedSummary'

function Figure({ label, value, hint }: { label: string; value: number; hint?: string }) {
    return (
        <div className="bg-black/30 rounded p-3">
            <div className="text-2xl font-mono text-white">{value.toLocaleString()}</div>
            <div className="text-sm text-gray-300">{label}</div>
            {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
        </div>
    )
}

export function ParkedFacesCard() {
    const { summary, computedAt, isCurrent, isMeasuring, isBusy, error, measure } = useParkedSummary()

    return (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                    <h3 className="font-medium text-white">Review Queue: Parked Faces</h3>
                    <p className="text-sm text-gray-400">
                        Unassigned faces that are too small or blurry, or that appear only once, would be set aside from review.
                        This is a count only: nothing is ignored, assigned or deleted.
                    </p>
                </div>
                <button
                    onClick={() => void measure()}
                    disabled={isMeasuring}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                >
                    {isMeasuring ? 'Calculating...' : summary ? 'Recalculate' : 'Calculate'}
                </button>
            </div>

            {isMeasuring && (
                <p className="text-sm text-indigo-300 animate-pulse mb-3">
                    Comparing every unassigned face with every other. This can take up to a minute on a large library.
                </p>
            )}
            {isBusy && (
                <p className="text-sm text-amber-300 mb-3">A scan or AI work is running. Try again when it has finished.</p>
            )}
            {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

            {!summary && !isMeasuring && !error && (
                <p className="text-sm text-gray-400">Not calculated yet.</p>
            )}

            {summary && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                        <Figure label="Unassigned faces" value={summary.unassigned} />
                        <Figure label="Worth reviewing" value={summary.worthReviewing} hint="Clear, and with at least one twin or near a named person" />
                        <Figure label="Parked" value={summary.parked} hint="Low quality plus faces that appear once" />
                        <Figure label="Low quality" value={summary.lowQuality} hint={`Face under ${summary.settings.minFaceArea.toLocaleString()} px² or blur under ${summary.settings.minBlurScore}`} />
                        <Figure label="Appear once" value={summary.singleton} hint={`No twin within ${summary.settings.twinDistance}`} />
                        <Figure label="Kept: near a named person" value={summary.nearNamed} hint="Appear once but are close to someone you named" />
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                        <p>
                            {summary.sameShotOnly.toLocaleString()} clear faces have only the same shot saved again (copies, RAW plus JPG, frames within one second) as their twins, so they count as appearing once.
                            At the looser twin distance {summary.settings.alternativeTwinDistance}, {summary.singletonAtAlternativeDistance.toLocaleString()} would appear once.
                        </p>
                        <p>
                            Lone faces near a named person, by distance:{' '}
                            {summary.nearNamedByDistance.map(entry => `within ${entry.distance}: ${entry.count.toLocaleString()}`).join(' · ')}
                            {` (kept in review up to ${summary.settings.suggestionDistance}).`}
                        </p>
                        <p>
                            {computedAt && `Measured ${new Date(computedAt).toLocaleString()}.`}
                            {!isCurrent && ' Out of date: faces or people have changed since.'}
                        </p>
                    </div>
                </>
            )}
        </div>
    )
}
