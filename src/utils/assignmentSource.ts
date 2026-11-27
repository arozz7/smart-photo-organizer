/** Plain words for how a face was given to its person (the `assignment_source` the database keeps). */
export function describeSource(source: string | null): string {
    switch (source) {
        case 'ai_scan': return 'by a scan'
        case 'auto_rematch': return 'by the re-match'
        case 'auto_scan': return 'by an automatic match'
        case 'auto_suggestion': return 'from a suggestion'
        case 'profile_match': return 'from the Turned faces list'
        case null: return 'unknown'
        default: return 'by you'
    }
}
