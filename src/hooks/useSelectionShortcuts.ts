import { useEffect } from 'react'

interface SelectionShortcuts {
    selectAll: () => void
    selectNone: () => void
    loadMoreAndSelect: () => void
    /** Escape clears a selection only when there is one. */
    hasSelection: boolean
    /** L loads the next page only when there is one. */
    canLoadMore: boolean
}

/** A key pressed while typing or choosing from a drop-down is not a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
}

/**
 * Keys for a list of faces while it is open: Ctrl+A (Cmd+A) selects all loaded faces, Escape clears the selection, L loads the next page and
 * selects it. Keys another part of the page already handled (a dialog closed with Escape) are left alone.
 */
export function useSelectionShortcuts({ selectAll, selectNone, loadMoreAndSelect, hasSelection, canLoadMore }: SelectionShortcuts) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || isTypingTarget(event.target)) return
            const key = event.key.toLowerCase()
            if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'a') {
                event.preventDefault()
                selectAll()
                return
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (key === 'escape' && hasSelection) selectNone()
            else if (key === 'l' && canLoadMore) {
                event.preventDefault()
                loadMoreAndSelect()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [selectAll, selectNone, loadMoreAndSelect, hasSelection, canLoadMore])
}
