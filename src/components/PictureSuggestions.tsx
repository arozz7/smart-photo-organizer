import FaceThumbnail from './FaceThumbnail'
import { FloatingActionBar, FloatingActionButton } from './FloatingActionBar'
import { FloatingBarClearance, LoadMoreControls, SelectionToolbar } from './SelectionControls'
import { useSelectionShortcuts } from '../hooks/useSelectionShortcuts'
import type { PictureList, PictureSuggestionsController, PictureTile } from '../hooks/usePictureSuggestions'
import { surroundingBox } from '../utils/pictureCrop'

const LISTS: { list: PictureList; label: string }[] = [
    { list: 'unassigned', label: 'In Review Needed' },
    { list: 'assigned', label: 'Assigned to a person' },
]

const formatCount = (count: number) => count.toLocaleString('en-US')
const plural = (count: number) => `${formatCount(count)} ${count === 1 ? 'face' : 'faces'}`

/** Plain words for how an assigned face was given to its person. */
function describeSource(source: string | null): string {
    switch (source) {
        case 'ai_scan': return 'by a scan'
        case 'auto_rematch': return 'by the re-match'
        case 'auto_scan': return 'by an automatic match'
        case 'auto_suggestion': return 'from a suggestion'
        case 'profile_match': return 'from the Turned faces list'
        case null: return 'unknown'
        default: return 'by you'
    }
}

interface TileProps {
    tile: PictureTile
    selected: boolean
    onToggle: (faceId: number, extend?: boolean) => void
    onViewPhoto: (photoId: number) => void
}

function SuggestionTile({ tile, selected, onToggle, onViewPhoto }: TileProps) {
    const shown = surroundingBox(tile.box, tile.photoWidth, tile.photoHeight)
    return (
        <div
            data-testid={`picture-tile-${tile.faceId}`}
            title={`${Math.round(tile.likelihood)}% likely only a picture (model answer ${tile.score.toFixed(2)})`}
            onClick={(event) => onToggle(tile.faceId, event.shiftKey)}
            className={`rounded-lg overflow-hidden border-2 cursor-pointer relative group bg-gray-900 ${selected ? 'border-rose-500' : 'border-transparent hover:border-gray-700'}`}
        >
            <div className="aspect-square relative">
                <FaceThumbnail
                    src={`local-resource://${encodeURIComponent(tile.filePath || '')}`}
                    fallbackSrc={`local-resource://${encodeURIComponent(tile.previewPath || tile.filePath || '')}`}
                    box={shown}
                    originalImageWidth={tile.photoWidth ?? undefined}
                    useServerCrop={true}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute top-1 right-1 bg-black/60 backdrop-blur rounded px-1.5 py-0.5 text-[10px] text-gray-200 font-mono">{Math.round(tile.likelihood)}%</div>
                {selected && <div className="absolute inset-0 bg-rose-500/20 flex items-center justify-center">✓</div>}
                <button
                    className="absolute bottom-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-indigo-600 z-20 shadow-lg"
                    title="View Original Photo"
                    onClick={(event) => {
                        event.stopPropagation()
                        onViewPhoto(tile.photoId)
                    }}
                >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                </button>
            </div>
            {tile.personId !== null && (
                <div className="px-2 py-1 text-[11px] leading-tight text-gray-300">
                    <div className="font-semibold text-white truncate">{tile.personName ?? `Person ${tile.personId}`}</div>
                    <div className="text-gray-400">{describeSource(tile.source)}, {tile.confirmed ? 'confirmed' : 'not confirmed'}</div>
                </div>
            )}
        </div>
    )
}

interface PictureSuggestionsProps {
    ctrl: PictureSuggestionsController
    onViewPhoto: (photoId: number) => void
}

/**
 * Edge Cases, "Pictures?": faces the vision model finds to be only a picture of a person (a billboard, poster, framed photo, screen, statue or toy),
 * among the faces in Review Needed and among those already assigned to people, most picture-like first, shown with their surroundings.
 * Nothing is ignored until the user selects faces and chooses to; "Keep" says they are real faces; the last ignore can be undone.
 */
export default function PictureSuggestions({ ctrl, onViewPhoto }: PictureSuggestionsProps) {
    const { overview, tiles, selectedIds, undoBatch, busy } = ctrl
    useSelectionShortcuts({
        selectAll: ctrl.selectAllLoaded,
        selectNone: ctrl.selectNone,
        loadMoreAndSelect: ctrl.loadMoreAndSelect,
        hasSelection: selectedIds.size > 0,
        canLoadMore: ctrl.hasMore && !ctrl.loading,
    })
    const assigned = overview?.list === 'assigned'
    const countFor = (choice: { unassigned: number; assigned: number }) => (assigned ? choice.assigned : choice.unassigned)
    const atChosen = overview?.choices.find(choice => choice.likelihood === overview.minLikelihood)

    return (
        <div className="space-y-4">
            <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50 space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                    <div className="flex rounded-lg overflow-hidden border border-gray-700" role="group" aria-label="List">
                        {LISTS.map(({ list, label }) => (
                            <button
                                key={list}
                                onClick={() => overview?.list !== list && ctrl.setList(list)}
                                disabled={!overview || busy}
                                aria-pressed={overview?.list === list}
                                className={`px-3 py-1 text-xs font-medium ${overview?.list === list ? 'bg-rose-500/20 text-rose-300' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}
                            >
                                {label}{atChosen ? ` (${formatCount(list === 'assigned' ? atChosen.assigned : atChosen.unassigned)})` : ''}
                            </button>
                        ))}
                    </div>
                    {overview && (
                        <>
                            <label htmlFor="picture-likelihood" className="text-gray-400">Likely a picture, at least</label>
                            <select
                                id="picture-likelihood"
                                value={String(overview.minLikelihood)}
                                disabled={busy}
                                onChange={(event) => ctrl.setLikelihood(Number(event.target.value))}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                            >
                                {!overview.choices.some(choice => choice.likelihood === overview.minLikelihood) && (
                                    <option value={String(overview.minLikelihood)}>{overview.minLikelihood}% ({plural(overview.current.total)})</option>
                                )}
                                {overview.choices.map(choice => (
                                    <option key={choice.likelihood} value={String(choice.likelihood)}>{choice.likelihood}% ({plural(countFor(choice))})</option>
                                ))}
                            </select>
                            <span>{plural(overview.current.total)} are suggested at this likelihood.</span>
                        </>
                    )}
                </div>

                {overview && (
                    <p className="text-xs text-gray-400">
                        Checked {formatCount(overview.checked)} of {formatCount(overview.candidates)} faces by the vision model
                        ({formatCount(overview.assignedChecked)} of {formatCount(overview.assignedCandidates)} assigned faces; those come first); more appear here as the check runs
                        (Settings &gt; Database Management &gt; Check for Pictures of Faces).
                    </p>
                )}

                {overview && !assigned && (
                    <div className="flex items-start gap-2 text-sm text-gray-300">
                        <input
                            id="picture-hide"
                            type="checkbox"
                            checked={overview.hideFromReview}
                            disabled={busy}
                            onChange={(event) => ctrl.setHideFromReview(event.target.checked)}
                            className="mt-1 accent-rose-500"
                        />
                        <div>
                            <label htmlFor="picture-hide" className="cursor-pointer">Hide these faces from Review Needed</label>
                            <p className="text-xs text-gray-400">
                                {overview.hideFromReview
                                    ? `${plural(overview.hiddenFromReview)} ${overview.hiddenFromReview === 1 ? 'is' : 'are'} hidden there and reviewed here.`
                                    : `${plural(overview.hideable)} would be hidden there.`}
                                {' '}Keep sends a face back to Review Needed; nothing is ignored by hiding it.
                            </p>
                        </div>
                    </div>
                )}

                <p className="text-xs text-gray-500">
                    The vision model finds these faces to be only a picture of a face (a billboard, poster, framed photo, screen, statue, toy or drawing). It can be wrong:
                    real faces on a board, in a mirror or behind glass can look the same, so check each one in its surroundings. Nothing is ignored until you choose; Keep says it is a real face.
                    {assigned && ' Ignoring a face that is assigned to a person is taken out of the person (their centroids and the search index follow); Undo puts it back exactly as it was.'}
                </p>
            </div>

            {undoBatch && (
                <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-2 text-sm text-indigo-200">
                    <span>Ignored {plural(undoBatch.length)} as pictures. They are in the Ignored filter too.</span>
                    <button onClick={ctrl.undoLast} disabled={busy} className="font-medium text-indigo-300 hover:text-white disabled:opacity-50">Undo</button>
                </div>
            )}

            <SelectionToolbar
                selectedCount={selectedIds.size}
                summary={`showing ${formatCount(tiles.length)} of ${formatCount(overview?.current.total ?? 0)}`}
                onSelectAll={ctrl.selectAllLoaded}
                onSelectNone={ctrl.selectNone}
            />

            {tiles.length === 0 && !ctrl.loading && (
                <div className="text-center text-sm text-gray-500 py-12">No faces reach this likelihood yet.</div>
            )}

            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] select-none">
                {tiles.map(tile => (
                    <SuggestionTile key={tile.faceId} tile={tile} selected={selectedIds.has(tile.faceId)} onToggle={ctrl.toggle} onViewPhoto={onViewPhoto} />
                ))}
            </div>

            {ctrl.hasMore && (
                <LoadMoreControls loading={ctrl.loading} onLoadMore={ctrl.loadMore} onLoadMoreAndSelect={ctrl.loadMoreAndSelect} />
            )}

            <FloatingActionBar selectedCount={selectedIds.size} onClearSelection={ctrl.selectNone}>
                <FloatingActionButton label="Keep (real face)" onClick={ctrl.keepSelected} disabled={busy} variant="success" />
                <div className="h-4 w-px bg-gray-700" />
                <FloatingActionButton label={assigned ? 'Remove from person and ignore as picture' : 'Ignore as picture'} onClick={ctrl.ignoreSelected} disabled={busy} variant="danger" />
            </FloatingActionBar>
            <FloatingBarClearance active={selectedIds.size > 0} />
        </div>
    )
}
