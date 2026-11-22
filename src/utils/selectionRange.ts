/**
 * The ids from `anchor` to `target` in list order, both included, whichever comes first (shift-click range selection).
 * When the anchor is not in the list (it was removed, or is not selectable) only the target is returned; when the target is not in the list, nothing.
 */
export function idsBetween(ids: readonly number[], anchor: number, target: number): number[] {
    const to = ids.indexOf(target)
    if (to === -1) return []
    const from = ids.indexOf(anchor)
    if (from === -1) return [target]
    return ids.slice(Math.min(from, to), Math.max(from, to) + 1)
}
