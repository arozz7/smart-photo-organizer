import { useCallback, useRef, useState } from 'react'
import { idsBetween } from '../utils/selectionRange'

/**
 * The selection of a list of faces (Not a Face?, Turned faces, Pictures?): click toggles one face, shift-click adds the range from the last plain
 * click (the anchor) to the face clicked, "select all" takes every selectable face loaded, `addToSelection` adds a page that was just loaded.
 *
 * @param selectableIds The faces the user can select, in the order they are shown (the order of a range).
 */
export function useListSelection(selectableIds: readonly number[]) {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const anchor = useRef<number | null>(null)

    const toggle = useCallback((faceId: number, extend = false) => {
        const from = anchor.current
        if (extend && from !== null && from !== faceId && selectableIds.includes(from)) {
            const range = idsBetween(selectableIds, from, faceId)
            setSelectedIds(prev => new Set([...prev, ...range]))
            return
        }
        anchor.current = faceId
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (!next.delete(faceId)) next.add(faceId)
            return next
        })
    }, [selectableIds])

    const selectAllLoaded = useCallback(() => setSelectedIds(new Set(selectableIds)), [selectableIds])
    const selectNone = useCallback(() => {
        anchor.current = null
        setSelectedIds(new Set())
    }, [])
    const addToSelection = useCallback((faceIds: readonly number[]) => {
        if (faceIds.length > 0) setSelectedIds(prev => new Set([...prev, ...faceIds]))
    }, [])

    return { selectedIds, setSelectedIds, toggle, selectAllLoaded, selectNone, addToSelection }
}
