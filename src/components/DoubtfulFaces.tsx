import FaceThumbnail from './FaceThumbnail'
import { FloatingActionBar, FloatingActionButton } from './FloatingActionBar'
import { FloatingBarClearance, LoadMoreControls, SelectionToolbar } from './SelectionControls'
import { useSelectionShortcuts } from '../hooks/useSelectionShortcuts'
import type { DoubtfulFacesController, DoubtfulTile } from '../hooks/useDoubtfulFaces'
import { describeSource } from '../utils/assignmentSource'

const formatCount = (count: number) => count.toLocaleString('en-US')
const plural = (count: number) => `${formatCount(count)} ${count === 1 ? 'face' : 'faces'}`

interface TileProps {
    tile: DoubtfulTile
    selected: boolean
    onToggle: (faceId: number, extend?: boolean) => void
    onViewPhoto: (photoId: number) => void
}

function DoubtfulFaceTile({ tile, selected, onToggle, onViewPhoto }: TileProps) {
    return (
        <div
            data-testid={`doubtful-tile-${tile.faceId}`}
            title={`The model finds no clear face here (model answer ${tile.score.toFixed(2)}; higher means more doubtful)`}
            onClick={(event) => onToggle(tile.faceId, event.shiftKey)}
            className={`rounded-lg overflow-hidden border-2 cursor-pointer relative group bg-gray-900 ${selected ? 'border-violet-500' : 'border-transparent hover:border-gray-700'}`}
        >
            <div className="aspect-square relative">
                <FaceThumbnail
                    src={`local-resource://${encodeURIComponent(tile.filePath || '')}`}
                    fallbackSrc={`local-resource://${encodeURIComponent(tile.previewPath || tile.filePath || '')}`}
                    box={tile.box}
                    originalImageWidth={tile.photoWidth ?? undefined}
                    useServerCrop={true}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute top-1 right-1 bg-black/60 backdrop-blur rounded px-1.5 py-0.5 text-[10px] text-gray-200 font-mono">{tile.score.toFixed(1)}</div>
                {selected && <div className="absolute inset-0 bg-violet-500/20 flex items-center justify-center">✓</div>}
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
            <div className="px-2 py-1 text-[11px] leading-tight text-gray-300">
                <div className="font-semibold text-white truncate">{tile.personName ?? `Person ${tile.personId}`}</div>
                <div className="text-gray-400">{describeSource(tile.source)}, {tile.confirmed ? 'confirmed' : 'not confirmed'}</div>
            </div>
        </div>
    )
}

interface DoubtfulFacesProps {
    ctrl: DoubtfulFacesController
    onViewPhoto: (photoId: number) => void
}

/**
 * Edge Cases, "Doubtful faces": faces already assigned to a person where the vision model finds no clear face (an animal, an object, a hand, a
 * picture of a face), the most doubtful first, each cropped to the face. Nothing changes until the user selects faces and chooses: "Keep" says
 * they are real faces, "Back to suggestions" takes them out of the person but keeps that person as the suggestion, "Not a face" ignores them.
 * The last change can be undone.
 */
export default function DoubtfulFaces({ ctrl, onViewPhoto }: DoubtfulFacesProps) {
    const { overview, tiles, selectedIds, undoBatch, busy } = ctrl
    useSelectionShortcuts({
        selectAll: ctrl.selectAllLoaded,
        selectNone: ctrl.selectNone,
        loadMoreAndSelect: ctrl.loadMoreAndSelect,
        hasSelection: selectedIds.size > 0,
        canLoadMore: ctrl.hasMore && !ctrl.loading,
    })

    return (
        <div className="space-y-4">
            <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50 space-y-3">
                {overview && (
                    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                        <label htmlFor="doubtful-level" className="text-gray-400">Doubt level, at least</label>
                        <select
                            id="doubtful-level"
                            value={String(overview.minScore)}
                            disabled={busy}
                            onChange={(event) => ctrl.setMinScore(Number(event.target.value))}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                        >
                            {!overview.choices.some(choice => choice.score === overview.minScore) && (
                                <option value={String(overview.minScore)}>{overview.minScore} ({plural(overview.current.total)})</option>
                            )}
                            {overview.choices.map(choice => (
                                <option key={choice.score} value={String(choice.score)}>{choice.score} ({plural(choice.total)})</option>
                            ))}
                        </select>
                        <label htmlFor="doubtful-person" className="text-gray-400">Person</label>
                        <select
                            id="doubtful-person"
                            aria-label="Person"
                            value={ctrl.personId === null ? '' : String(ctrl.personId)}
                            disabled={busy}
                            onChange={(event) => ctrl.setPerson(event.target.value === '' ? null : Number(event.target.value))}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                        >
                            <option value="">Everyone ({formatCount(overview.current.total)})</option>
                            {overview.people.map(person => (
                                <option key={person.personId} value={String(person.personId)}>{person.name ?? `Person ${person.personId}`} ({formatCount(person.count)})</option>
                            ))}
                        </select>
                        <span>{formatCount(overview.current.total)} assigned {overview.current.total === 1 ? 'face is' : 'faces are'} doubtful at this level.</span>
                    </div>
                )}

                {overview && (
                    <p className="text-xs text-gray-400">
                        Checked {formatCount(overview.checked)} of {formatCount(overview.candidates)} assigned faces by the vision model, the person with the most faces first;
                        more appear here as the check runs (Settings &gt; Database Management &gt; Check Assigned Faces).
                    </p>
                )}

                <p className="text-xs text-gray-500">
                    The vision model finds no clear face in these faces, although they are assigned to a person (an animal, an object, a hand or a picture of a face).
                    The level is the model's own answer, not a percentage: higher means more doubtful. It can be wrong, so use the eye button to see each one in its photo.
                    Nothing is changed until you choose. Keep says it is a real face. Back to suggestions takes it out of the person and keeps that person as the suggestion; Not a face
                    ignores it. Either way the person's centroids and the search index follow, and Undo puts it back exactly as it was.
                </p>
            </div>

            {undoBatch && (
                <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-2 text-sm text-indigo-200">
                    <span>{undoBatch.kind === 'ignore' ? `Ignored ${plural(undoBatch.faceIds.length)} as not faces. They are in the Ignored filter too.` : `Moved ${plural(undoBatch.faceIds.length)} back to suggestions. They are in Review Needed.`}</span>
                    <button onClick={ctrl.undoLast} disabled={busy} className="font-medium text-indigo-300 hover:text-white disabled:opacity-50">Undo</button>
                </div>
            )}

            <SelectionToolbar
                selectedCount={selectedIds.size}
                summary={`showing ${formatCount(tiles.length)} of ${formatCount(ctrl.personId === null ? overview?.current.total ?? 0 : overview?.people.find(p => p.personId === ctrl.personId)?.count ?? 0)}`}
                onSelectAll={ctrl.selectAllLoaded}
                onSelectNone={ctrl.selectNone}
            />

            {tiles.length === 0 && !ctrl.loading && (
                <div className="text-center text-sm text-gray-500 py-12">No assigned faces reach this doubt level yet.</div>
            )}

            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] select-none">
                {tiles.map(tile => (
                    <DoubtfulFaceTile key={tile.faceId} tile={tile} selected={selectedIds.has(tile.faceId)} onToggle={ctrl.toggle} onViewPhoto={onViewPhoto} />
                ))}
            </div>

            {ctrl.hasMore && (
                <LoadMoreControls loading={ctrl.loading} onLoadMore={ctrl.loadMore} onLoadMoreAndSelect={ctrl.loadMoreAndSelect} />
            )}

            <FloatingActionBar selectedCount={selectedIds.size} onClearSelection={ctrl.selectNone}>
                <FloatingActionButton label="Keep (real face)" onClick={ctrl.keepSelected} disabled={busy} variant="success" />
                <div className="h-4 w-px bg-gray-700" />
                <FloatingActionButton label="Back to suggestions" onClick={ctrl.unassignSelected} disabled={busy} variant="primary" />
                <div className="h-4 w-px bg-gray-700" />
                <FloatingActionButton label="Not a face (ignore)" onClick={ctrl.ignoreSelected} disabled={busy} variant="danger" />
            </FloatingActionBar>
            <FloatingBarClearance active={selectedIds.size > 0} />
        </div>
    )
}
