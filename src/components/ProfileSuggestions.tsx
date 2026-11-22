import FaceThumbnail from './FaceThumbnail'
import { FloatingActionBar, FloatingActionButton } from './FloatingActionBar'
import { FloatingBarClearance, LoadMoreControls, SelectionToolbar } from './SelectionControls'
import { useSelectionShortcuts } from '../hooks/useSelectionShortcuts'
import type { ProfileFaceTile, ProfileRow, ProfileSuggestionsController } from '../hooks/useProfileSuggestions'
import { describePose } from '../utils/nonFacePose'

const ANGLES = [40, 50, 60, 70]

const formatCount = (count: number) => count.toLocaleString('en-US')
const plural = (count: number) => `${formatCount(count)} ${count === 1 ? 'face' : 'faces'}`

function Thumb({ tile, className }: { tile: ProfileFaceTile; className: string }) {
    return (
        <FaceThumbnail
            src={`local-resource://${encodeURIComponent(tile.filePath || '')}`}
            fallbackSrc={`local-resource://${encodeURIComponent(tile.previewPath || tile.filePath || '')}`}
            box={tile.box}
            originalImageWidth={tile.photoWidth ?? undefined}
            useServerCrop={true}
            className={className}
        />
    )
}

interface RowProps {
    row: ProfileRow
    selected: boolean
    busy: boolean
    onToggle: (faceId: number, extend?: boolean) => void
    onAssignTo: (faceId: number, personId: number) => void
    onViewPhoto: (photoId: number) => void
}

function SuggestionRow({ row, selected, busy, onToggle, onAssignTo, onViewPhoto }: RowProps) {
    const pose = describePose(row.tile.yaw)
    return (
        <div data-testid={`profile-row-${row.faceId}`} className="flex items-center gap-4 bg-gray-800/30 border border-gray-700/50 rounded-xl p-2">
            <div
                data-testid={`profile-face-${row.faceId}`}
                onClick={(event) => onToggle(row.faceId, event.shiftKey)}
                className={`w-28 h-28 shrink-0 rounded-lg overflow-hidden border-2 cursor-pointer relative group ${selected ? 'border-emerald-500' : 'border-transparent hover:border-gray-600'}`}
            >
                <Thumb tile={row.tile} className="w-full h-full object-cover" />
                <div className="absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-amber-500/80 text-black">{pose.text}</div>
                {selected && <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">✓</div>}
                <button
                    className="absolute bottom-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-indigo-600 z-20 shadow-lg"
                    title="View Original Photo"
                    onClick={(event) => {
                        event.stopPropagation()
                        onViewPhoto(row.photoId)
                    }}
                >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 min-w-0 text-sm text-gray-300 space-y-1">
                <div>
                    Looks like <span className="font-semibold text-white">{row.person.name}</span>
                    <span className="ml-2 font-mono text-xs text-gray-400" title="Distance to their nearest turned face (smaller is closer)">distance {row.person.distance.toFixed(2)}</span>
                </div>
                {row.also && (
                    <div className="flex items-center gap-2 text-amber-300">
                        <span>Also close to {row.also.name}</span>
                        <span className="font-mono text-xs text-amber-400/80">{row.also.distance.toFixed(2)}</span>
                        <button
                            onClick={() => onAssignTo(row.faceId, row.also!.personId)}
                            disabled={busy}
                            className="px-2 py-0.5 text-xs rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 disabled:opacity-50"
                        >
                            It&apos;s {row.also.name}
                        </button>
                    </div>
                )}
            </div>

            <div className="flex gap-1 shrink-0" title={`${row.person.name}: the two nearest turned faces, then a sharp front view`}>
                {row.examples.map(example => (
                    <div key={example.faceId} className="w-20 h-20 rounded-md overflow-hidden border border-gray-700">
                        <Thumb tile={example} className="w-full h-full object-cover" />
                    </div>
                ))}
                {row.frontal && (
                    <div className="w-20 h-20 rounded-md overflow-hidden border border-gray-600 opacity-80">
                        <Thumb tile={row.frontal} className="w-full h-full object-cover" />
                    </div>
                )}
            </div>
        </div>
    )
}

interface ProfileSuggestionsProps {
    ctrl: ProfileSuggestionsController
    onViewPhoto: (photoId: number) => void
    /** The person the page is limited to (from the button on their page), or null for everyone. */
    personName: string | null
    onShowEveryone: () => void
}

/**
 * Edge Cases, "Turned faces": unassigned faces turned 40 degrees or more, each with the person whose confirmed turned faces
 * it resembles, shown next to those faces. Nothing is assigned until the user selects faces and chooses to; the last assignment can be undone.
 */
export default function ProfileSuggestions({ ctrl, onViewPhoto, personName, onShowEveryone }: ProfileSuggestionsProps) {
    const { overview, rows, selectedIds, undoBatch, busy } = ctrl
    useSelectionShortcuts({
        selectAll: ctrl.selectAllLoaded,
        selectNone: ctrl.selectNone,
        loadMoreAndSelect: ctrl.loadMoreAndSelect,
        hasSelection: selectedIds.size > 0,
        canLoadMore: ctrl.hasMore && !ctrl.loading,
    })
    const settings = overview?.settings

    const groups: { personId: number; name: string; rows: ProfileRow[] }[] = []
    for (const row of rows) {
        const last = groups[groups.length - 1]
        if (last && last.personId === row.person.personId) last.rows.push(row)
        else groups.push({ personId: row.person.personId, name: row.person.name, rows: [row] })
    }
    const countOf = (personId: number) => overview?.byPerson.find(item => item.personId === personId)?.count ?? 0

    return (
        <div className="space-y-4">
            <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50 space-y-3">
                {personName && (
                    <div className="flex items-center justify-between text-sm text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-1.5">
                        <span>Showing turned faces suggested for {personName}.</span>
                        <button onClick={onShowEveryone} className="font-medium text-sky-300 hover:text-white">Show everyone</button>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                    {settings && (
                        <>
                            <label htmlFor="profile-distance" className="text-gray-400">Distance up to</label>
                            <select
                                id="profile-distance"
                                value={String(settings.distance)}
                                disabled={busy}
                                onChange={(event) => ctrl.setDistance(Number(event.target.value))}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                            >
                                {settings.distanceChoices.map(choice => (
                                    <option key={choice} value={String(choice)}>{choice.toFixed(1)}{choice === settings.defaultDistance ? ' (default)' : ''}</option>
                                ))}
                            </select>
                            <label htmlFor="profile-angle" className="text-gray-400">Turned from</label>
                            <select
                                id="profile-angle"
                                value={String(settings.minYaw)}
                                disabled={busy}
                                onChange={(event) => ctrl.setMinYaw(Number(event.target.value))}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                            >
                                {ANGLES.filter(angle => angle >= settings.minYawAllowed && angle <= settings.maxYawAllowed).map(angle => (
                                    <option key={angle} value={String(angle)}>{angle}°{angle === settings.defaultMinYaw ? ' (default)' : ''}</option>
                                ))}
                            </select>
                        </>
                    )}
                    <button
                        onClick={ctrl.refresh}
                        disabled={busy || overview?.state === 'computing'}
                        className={`px-3 py-1 text-xs font-medium rounded-lg border ${overview?.stale ? 'border-sky-500/50 text-sky-300 bg-sky-500/10' : 'border-gray-700 text-gray-400 hover:text-gray-200'} disabled:opacity-50`}
                    >
                        Refresh
                    </button>
                    {overview?.state === 'ready' && <span>{plural(overview.total)} suggested{overview.twoNames > 0 ? `, ${formatCount(overview.twoNames)} with two names` : ''}.</span>}
                </div>
                {overview?.stale && (
                    <p className="text-xs text-sky-300">You assigned faces, so more turned faces may now match: choose Refresh to search again.</p>
                )}
                <p className="text-xs text-gray-500">
                    Each face is compared with the turned faces you have confirmed for each person (not with the front-view average that scans use), so it can only be suggested for someone who already has some.
                    {overview && overview.examples > 0 && <> {formatCount(overview.examples)} turned faces of {overview.peopleWithExamples} people are used.</>}
                    {' '}Brothers, sisters and look-alikes can be close: check the faces beside each suggestion. Nothing is assigned until you choose, and the last assignment can be undone.
                </p>
            </div>

            {undoBatch && (
                <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-2 text-sm text-indigo-200">
                    <span>Assigned {plural(undoBatch.length)}. They are confirmed on the person&apos;s page.</span>
                    <button onClick={ctrl.undoLast} disabled={busy} className="font-medium text-indigo-300 hover:text-white disabled:opacity-50">Undo</button>
                </div>
            )}

            {overview?.state === 'computing' && (
                <div className="text-center text-sm text-gray-400 py-12">
                    Comparing turned faces… {formatCount(overview.checked)} of {formatCount(overview.candidates)}
                </div>
            )}

            {overview?.state === 'error' && (
                <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-200">
                    <span>The search failed: {overview.error}</span>
                    <button onClick={ctrl.refresh} disabled={busy} className="font-medium text-red-300 hover:text-white disabled:opacity-50">Search again</button>
                </div>
            )}

            {overview?.state === 'ready' && overview.examples === 0 && (
                <div className="text-center text-sm text-gray-500 py-12">No one has confirmed turned faces yet, so there is nothing to compare with.</div>
            )}

            {overview?.state === 'ready' && overview.examples > 0 && rows.length === 0 && !ctrl.loading && (
                <div className="text-center text-sm text-gray-500 py-12">No turned faces match anyone at this distance.</div>
            )}

            {rows.length > 0 && (
                <SelectionToolbar
                    selectedCount={selectedIds.size}
                    summary={`showing ${formatCount(rows.length)}`}
                    note="Select all skips faces with two names: choose those yourself"
                    onSelectAll={ctrl.selectAllLoaded}
                    onSelectNone={ctrl.selectNone}
                />
            )}

            {groups.map(group => (
                <section key={`${group.personId}-${group.rows[0].faceId}`} className="space-y-2 select-none">
                    <h3 className="text-sm font-semibold text-white">{group.name} <span className="font-normal text-gray-400">{plural(countOf(group.personId) || group.rows.length)}</span></h3>
                    {group.rows.map(row => (
                        <SuggestionRow key={row.faceId} row={row} selected={selectedIds.has(row.faceId)} busy={busy} onToggle={ctrl.toggle} onAssignTo={ctrl.assignTo} onViewPhoto={onViewPhoto} />
                    ))}
                </section>
            ))}

            {ctrl.hasMore && (
                <LoadMoreControls loading={ctrl.loading} onLoadMore={ctrl.loadMore} onLoadMoreAndSelect={ctrl.loadMoreAndSelect} />
            )}

            <FloatingActionBar selectedCount={selectedIds.size} onClearSelection={ctrl.selectNone}>
                <FloatingActionButton label="Not this person" onClick={ctrl.dismissSelected} disabled={busy} variant="danger" />
                <div className="h-4 w-px bg-gray-700" />
                <FloatingActionButton label="Assign selected" onClick={ctrl.assignSelected} disabled={busy} variant="success" />
            </FloatingActionBar>
            <FloatingBarClearance active={selectedIds.size > 0} />
        </div>
    )
}
