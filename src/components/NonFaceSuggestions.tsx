import FaceThumbnail from './FaceThumbnail'
import { FloatingActionBar, FloatingActionButton } from './FloatingActionBar'
import type { ListMode, NonFaceSuggestionsController, NonFaceTile } from '../hooks/useNonFaceSuggestions'
import { describePose } from '../utils/nonFacePose'

const MODES: { mode: ListMode; label: string }[] = [
    { mode: 'detector', label: 'Detector score' },
    { mode: 'model', label: 'Model + detector' },
]

const formatCount = (count: number) => count.toLocaleString('en-US')
const plural = (count: number) => `${formatCount(count)} ${count === 1 ? 'face' : 'faces'}`

interface TileProps {
    tile: NonFaceTile
    selected: boolean
    onToggle: (faceId: number) => void
    onViewPhoto: (photoId: number) => void
}

function SuggestionTile({ tile, selected, onToggle, onViewPhoto }: TileProps) {
    const pose = describePose(tile.yaw)
    const badge = tile.likelihood !== undefined ? `${Math.round(tile.likelihood)}%` : tile.score.toFixed(2)
    const details = [
        tile.likelihood !== undefined ? `${Math.round(tile.likelihood)}% likely not a face` : null,
        tile.modelScore !== undefined ? `model ${tile.modelScore.toFixed(2)}` : null,
        `Detector score ${tile.score.toFixed(2)}`,
        tile.quality !== null ? `quality ${tile.quality.toFixed(2)}` : null,
        tile.blur !== null ? `sharpness ${Math.round(tile.blur)}` : null,
    ]
    return (
        <div
            data-testid={`nonface-tile-${tile.faceId}`}
            title={details.filter(Boolean).join(', ')}
            onClick={() => onToggle(tile.faceId)}
            className={`aspect-square rounded-lg overflow-hidden border-2 cursor-pointer relative group ${selected ? 'border-red-500' : 'border-transparent hover:border-gray-700'}`}
        >
            <FaceThumbnail
                src={`local-resource://${encodeURIComponent(tile.filePath || '')}`}
                fallbackSrc={`local-resource://${encodeURIComponent(tile.previewPath || tile.filePath || '')}`}
                box={tile.box}
                originalImageWidth={tile.photoWidth ?? undefined}
                useServerCrop={true}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
            />
            <div className="absolute top-1 right-1 bg-black/60 backdrop-blur rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono">{badge}</div>
            <div className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-mono backdrop-blur ${pose.turned ? 'bg-amber-500/80 text-black' : 'bg-black/60 text-gray-300'}`}>{pose.text}</div>
            {tile.quality !== null && <div className="absolute top-1 left-1 bg-black/60 backdrop-blur rounded px-1.5 py-0.5 text-[10px] text-gray-400 font-mono">Q {tile.quality.toFixed(2)}</div>}
            {selected && <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">✓</div>}
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
    )
}

interface NonFaceSuggestionsProps {
    ctrl: NonFaceSuggestionsController
    onViewPhoto: (photoId: number) => void
}

/**
 * Edge Cases, "Not a Face?": boxes the detector itself was unsure about, lowest score first, with the pose and quality of each.
 * Nothing is ignored until the user selects faces and chooses to; "Keep" tells the app these are faces, and the last ignore can be undone.
 */
export default function NonFaceSuggestions({ ctrl, onViewPhoto }: NonFaceSuggestionsProps) {
    const { overview, tiles, selectedIds, undoBatch, busy } = ctrl
    const current = overview?.current
    const detector = overview?.detector
    const model = overview?.model

    return (
        <div className="space-y-4">
            <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50 space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                    <div className="flex rounded-lg overflow-hidden border border-gray-700" role="group" aria-label="Ranking">
                        {MODES.map(({ mode, label }) => (
                            <button
                                key={mode}
                                onClick={() => overview?.mode !== mode && ctrl.setMode(mode)}
                                disabled={!overview || busy}
                                aria-pressed={overview?.mode === mode}
                                className={`px-3 py-1 text-xs font-medium ${overview?.mode === mode ? 'bg-orange-500/20 text-orange-300' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {detector && (
                        <>
                            <label htmlFor="nonface-cutoff" className="text-gray-400">Detector score below</label>
                            <select
                                id="nonface-cutoff"
                                value={String(detector.cutoff)}
                                disabled={busy}
                                onChange={(event) => ctrl.setCutoff(Number(event.target.value))}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                            >
                                {!detector.choices.some(choice => choice.cutoff === detector.cutoff) && current && (
                                    <option value={String(detector.cutoff)}>{detector.cutoff.toFixed(2)} ({plural(current.total)})</option>
                                )}
                                {detector.choices.map(choice => (
                                    <option key={choice.cutoff} value={String(choice.cutoff)}>{choice.cutoff.toFixed(2)} ({plural(choice.total)})</option>
                                ))}
                            </select>
                        </>
                    )}
                    {model && (
                        <>
                            <label htmlFor="nonface-likelihood" className="text-gray-400">Likely not a face, at least</label>
                            <select
                                id="nonface-likelihood"
                                value={String(model.minLikelihood)}
                                disabled={busy}
                                onChange={(event) => ctrl.setLikelihood(Number(event.target.value))}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
                            >
                                {!model.choices.some(choice => choice.likelihood === model.minLikelihood) && current && (
                                    <option value={String(model.minLikelihood)}>{model.minLikelihood}% ({plural(current.total)})</option>
                                )}
                                {model.choices.map(choice => (
                                    <option key={choice.likelihood} value={String(choice.likelihood)}>{choice.likelihood}% ({plural(choice.total)})</option>
                                ))}
                            </select>
                        </>
                    )}
                    {current && <span>{plural(current.total)} are suggested at this cut-off.</span>}
                </div>
                {model && (
                    <p className="text-xs text-gray-400">
                        The vision model has looked at {formatCount(model.checked)} of {formatCount(model.candidates)} uncertain faces; more appear here as the check runs
                        (Settings &gt; Database Management &gt; Check Uncertain Faces). The percentage is an estimate from the model's answer and the detector score,
                        fitted on the faces you reviewed; it leans against faces seen from the side, so look at the turned ones twice.
                    </p>
                )}
                <p className="text-xs text-gray-500">
                    {detector
                        ? 'The detector gives every box a confidence score; low scores are often dark blobs, backs of heads or hair, but also real faces that are turned, looking down, partly covered or blurry.'
                        : 'Faces the model answered "no clear face" for, most likely first. Real faces that are turned, looking down, partly covered or blurry can be in it too.'}
                    {' '}{current && current.turned > 0 && <span className="text-amber-400">{formatCount(current.turned)} of them are turned 45° or more.</span>}{' '}
                    Check the thumbnails: nothing is ignored until you choose, and Keep tells the app these are faces.
                </p>
            </div>

            {undoBatch && (
                <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-2 text-sm text-indigo-200">
                    <span>Ignored {plural(undoBatch.length)}. They are in the Ignored filter too.</span>
                    <button onClick={ctrl.undoLast} disabled={busy} className="font-medium text-indigo-300 hover:text-white disabled:opacity-50">Undo</button>
                </div>
            )}

            <div className="flex justify-between items-center bg-gray-800/30 p-4 rounded-xl border border-gray-700/50">
                <div className="text-sm text-gray-400">{selectedIds.size} selected · showing {formatCount(tiles.length)} of {formatCount(ctrl.total)}</div>
                <div className="flex gap-2">
                    <button onClick={ctrl.selectAllLoaded} className="text-xs text-indigo-400 hover:text-indigo-300">Select all loaded</button>
                    <button onClick={ctrl.selectNone} className="text-xs text-gray-500 hover:text-gray-400">Deselect</button>
                </div>
            </div>

            {tiles.length === 0 && !ctrl.loading && (
                <div className="text-center text-sm text-gray-500 py-12">No faces below this cut-off.</div>
            )}

            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
                {tiles.map(tile => (
                    <SuggestionTile key={tile.faceId} tile={tile} selected={selectedIds.has(tile.faceId)} onToggle={ctrl.toggle} onViewPhoto={onViewPhoto} />
                ))}
            </div>

            {ctrl.hasMore && (
                <div className="flex justify-center mt-8">
                    <button onClick={ctrl.loadMore} disabled={ctrl.loading} className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-full text-sm font-medium transition-colors disabled:opacity-50">Load More</button>
                </div>
            )}

            <FloatingActionBar selectedCount={selectedIds.size} onClearSelection={ctrl.selectNone}>
                <FloatingActionButton label="Keep (these are faces)" onClick={ctrl.keepSelected} disabled={busy} variant="success" />
                <div className="h-4 w-px bg-gray-700" />
                <FloatingActionButton label="Ignore selected" onClick={ctrl.ignoreSelected} disabled={busy} variant="danger" />
            </FloatingActionBar>
        </div>
    )
}
