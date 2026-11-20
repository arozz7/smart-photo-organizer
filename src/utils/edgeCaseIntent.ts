import type { EdgeCaseFilterType } from '../components/EdgeCaseFilters'

/**
 * A request, made on another page, to open People > Edge Cases on a given filter (the "Find profile views" button on a
 * person's page). The People page reads it when it opens and clears it once it has taken it, so it never applies twice.
 */
export interface EdgeCaseIntent {
    tab: 'unnamed'
    filter: EdgeCaseFilterType
    personId: number | null
}

let pending: EdgeCaseIntent | null = null

export const requestProfileViews = (personId: number): void => {
    pending = { tab: 'unnamed', filter: 'profile', personId }
}
export const pendingEdgeCaseIntent = (): EdgeCaseIntent | null => pending
export const clearEdgeCaseIntent = (): void => {
    pending = null
}
