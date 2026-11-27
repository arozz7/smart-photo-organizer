import { useCallback, useEffect, useRef, useState } from 'react'
import type { EdgeCaseFilterType } from '../components/EdgeCaseFilters'
import { useNonFaceSuggestions } from './useNonFaceSuggestions'
import { useProfileSuggestions } from './useProfileSuggestions'
import { usePictureSuggestions } from './usePictureSuggestions'
import { useDoubtfulFaces } from './useDoubtfulFaces'
import { clearEdgeCaseIntent, pendingEdgeCaseIntent } from '../utils/edgeCaseIntent'

/** The tab People opens on when another page asked for an Edge Cases filter (see edgeCaseIntent), else undefined. */
export const pendingEdgeCaseTab = () => pendingEdgeCaseIntent()?.tab

/**
 * The Edge Cases filter that is open and the three suggestion lists (Not a face, Turned faces, Pictures), so the People page holds one hook
 * instead of one per list. A list loads only while its filter is open. `focusPersonId` limits Turned faces to one person
 * (from the button on that person's page).
 *
 * What Review Needed shows depends on those lists (faces hidden in Not a face? and Pictures?, faces assigned in Turned faces). When a list changes
 * something, Review Needed is marked out of date and `reloadReview` runs when the user goes back to it, not before (grouping the faces takes a while).
 */
export function useEdgeCaseSuggestions(reloadReview?: () => void) {
    const [activeFilter, setFilter] = useState<EdgeCaseFilterType>(() => pendingEdgeCaseIntent()?.filter ?? 'unnamed')
    const [focusPersonId, setFocusPersonId] = useState<number | null>(() => pendingEdgeCaseIntent()?.personId ?? null)
    useEffect(() => clearEdgeCaseIntent(), [])

    const reviewOutOfDate = useRef(false)
    const markReviewOutOfDate = useCallback(() => { reviewOutOfDate.current = true }, [])
    const setActiveFilter = useCallback((filter: EdgeCaseFilterType) => {
        setFilter(filter)
        if (filter === 'unnamed' && reviewOutOfDate.current) {
            reviewOutOfDate.current = false
            reloadReview?.()
        }
    }, [reloadReview])

    const nonFace = useNonFaceSuggestions({ enabled: activeFilter === 'nonface', onReviewChanged: markReviewOutOfDate })
    const profile = useProfileSuggestions({ enabled: activeFilter === 'profile', personId: focusPersonId, onReviewChanged: markReviewOutOfDate })

    const pictures = usePictureSuggestions({ enabled: activeFilter === 'pictures', onReviewChanged: markReviewOutOfDate })
    const doubtful = useDoubtfulFaces({ enabled: activeFilter === 'doubtful', onReviewChanged: markReviewOutOfDate })

    const counts = {
        nonface: nonFace.total,
        profile: profile.total,
        pictures: pictures.total,
        doubtful: doubtful.total,
        hidden: nonFace.overview?.hiddenFromReview ?? 0,
        hiddenPictures: pictures.overview?.hiddenFromReview ?? 0,
    }

    return { activeFilter, setActiveFilter, nonFace, profile, pictures, doubtful, counts, focusPersonId, showEveryone: () => setFocusPersonId(null) }
}

export type EdgeCaseSuggestions = ReturnType<typeof useEdgeCaseSuggestions>
