import { usePeople } from '../context/PeopleContext'
import type { EdgeCaseSuggestions } from '../hooks/useEdgeCaseSuggestions'
import NonFaceSuggestions from './NonFaceSuggestions'
import ProfileSuggestions from './ProfileSuggestions'
import PictureSuggestions from './PictureSuggestions'
import DoubtfulFaces from './DoubtfulFaces'
import type { EdgeCaseFilterType } from './EdgeCaseFilters'

interface EdgeCaseSuggestionPanelsProps {
    active: EdgeCaseFilterType
    suggestions: EdgeCaseSuggestions
    onViewPhoto: (photoId: number) => void
}

/** The Edge Cases panel of the suggestion lists (Not a face, Turned faces, Pictures); nothing for the other filters. */
export default function EdgeCaseSuggestionPanels({ active, suggestions, onViewPhoto }: EdgeCaseSuggestionPanelsProps) {
    const { people } = usePeople()
    if (active === 'nonface') return <NonFaceSuggestions ctrl={suggestions.nonFace} onViewPhoto={onViewPhoto} />
    if (active === 'pictures') return <PictureSuggestions ctrl={suggestions.pictures} onViewPhoto={onViewPhoto} />
    if (active === 'doubtful') return <DoubtfulFaces ctrl={suggestions.doubtful} onViewPhoto={onViewPhoto} />
    if (active !== 'profile') return null
    const personName = suggestions.focusPersonId === null ? null : people.find(person => person.id === suggestions.focusPersonId)?.name ?? `person ${suggestions.focusPersonId}`
    return <ProfileSuggestions ctrl={suggestions.profile} onViewPhoto={onViewPhoto} personName={personName} onShowEveryone={suggestions.showEveryone} />
}
