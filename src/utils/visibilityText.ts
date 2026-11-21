import type { VisibilityStatus } from '../hooks/useFaceVisibility'

/** One plain sentence about what a face check is doing right now (`noun`: what it checks, singular). */
export function describeState(status: VisibilityStatus, noun = 'uncertain face'): string {
    switch (status.state) {
        case 'off': return 'Switched off.'
        case 'done': return `Every ${noun} has been checked.`
        case 'error': return `Paused after an error (it tries again in half an hour, or press Run now): ${status.lastError ?? 'unknown error'}`
        case 'waiting-busy': return 'Paused: a scan or AI work is running.'
        case 'waiting-away': return `Waiting until you have been away for ${status.awayMinutes} ${status.awayMinutes === 1 ? 'minute' : 'minutes'}.`
        case 'scoring': return 'Checking faces...'
        case 'ready': return 'Ready; starts in a moment.'
    }
}
