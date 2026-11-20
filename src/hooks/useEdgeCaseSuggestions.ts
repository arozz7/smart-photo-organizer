import { useEffect, useState } from 'react'
import type { EdgeCaseFilterType } from '../components/EdgeCaseFilters'
import { useNonFaceSuggestions } from './useNonFaceSuggestions'
import { useProfileSuggestions } from './useProfileSuggestions'
import { clearEdgeCaseIntent, pendingEdgeCaseIntent } from '../utils/edgeCaseIntent'

/** The tab People opens on when another page asked for an Edge Cases filter (see edgeCaseIntent), else undefined. */
export const pendingEdgeCaseTab = () => pendingEdgeCaseIntent()?.tab

/**
 * The Edge Cases filter that is open and the two suggestion lists (Not a face, Turned faces), so the People page holds one hook
 * instead of one per list. A list loads only while its filter is open. `focusPersonId` limits Turned faces to one person
 * (from the button on that person's page).
 */
export function useEdgeCaseSuggestions() {
    const [activeFilter, setActiveFilter] = useState<EdgeCaseFilterType>(() => pendingEdgeCaseIntent()?.filter ?? 'unnamed')
    const [focusPersonId, setFocusPersonId] = useState<number | null>(() => pendingEdgeCaseIntent()?.personId ?? null)
    useEffect(() => clearEdgeCaseIntent(), [])

    const nonFace = useNonFaceSuggestions({ enabled: activeFilter === 'nonface' })
    const profile = useProfileSuggestions({ enabled: activeFilter === 'profile', personId: focusPersonId })

    return { activeFilter, setActiveFilter, nonFace, profile, focusPersonId, showEveryone: () => setFocusPersonId(null) }
}

export type EdgeCaseSuggestions = ReturnType<typeof useEdgeCaseSuggestions>
