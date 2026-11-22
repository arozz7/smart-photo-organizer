/**
 * The controls the suggestion lists (Not a Face?, Turned faces, Pictures?) share for choosing many faces: a toolbar that stays in view while the
 * user scrolls, Load More with "Load more and select", and room under the list for the floating action bar.
 */

interface SelectionToolbarProps {
    selectedCount: number
    /** What is shown, e.g. "showing 100 of 900". */
    summary: string
    onSelectAll: () => void
    onSelectNone: () => void
    /** Extra words after the summary (a note about what Select all skips). */
    note?: string
}

export function SelectionToolbar({ selectedCount, summary, onSelectAll, onSelectNone, note }: SelectionToolbarProps) {
    return (
        <div data-testid="selection-toolbar" className="sticky top-0 z-10 flex justify-between items-center gap-4 bg-gray-900/95 backdrop-blur p-4 rounded-xl border border-gray-700/50">
            <div className="text-sm text-gray-400">
                {selectedCount} selected · {summary}
                {note && <span className="text-gray-600"> · {note}</span>}
                <span className="text-gray-600"> · Shift+click selects a range</span>
            </div>
            <div className="flex gap-3 shrink-0">
                <button onClick={onSelectAll} title="Select all loaded faces (Ctrl+A)" className="text-xs text-indigo-400 hover:text-indigo-300">Select all loaded</button>
                <button onClick={onSelectNone} title="Clear the selection (Esc)" className="text-xs text-gray-500 hover:text-gray-400">Deselect</button>
            </div>
        </div>
    )
}

interface LoadMoreControlsProps {
    loading: boolean
    onLoadMore: () => void
    onLoadMoreAndSelect: () => void
}

export function LoadMoreControls({ loading, onLoadMore, onLoadMoreAndSelect }: LoadMoreControlsProps) {
    return (
        <div className="flex justify-center gap-3 mt-8">
            <button onClick={onLoadMore} disabled={loading} className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-full text-sm font-medium transition-colors disabled:opacity-50">Load More</button>
            <button
                onClick={onLoadMoreAndSelect}
                disabled={loading}
                title="Load the next page and select its faces (L)"
                className="px-6 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
            >
                Load more and select
            </button>
        </div>
    )
}

/** Empty space at the end of a list while the floating action bar is shown, so the bar never covers the last controls. */
export function FloatingBarClearance({ active }: { active: boolean }) {
    return active ? <div data-testid="bar-clearance" className="h-24" aria-hidden="true" /> : null
}
