/**
 * FaceVisibilityCard
 *
 * Asks the vision model whether a clear face is visible in the faces the detector was unsure about (a few at a time, on the
 * GPU, only when the user is away unless chosen otherwise). The answers improve Edge Cases > Not a Face?; the check itself
 * never ignores or changes a face. See docs/plans/non-face-and-picture-faces-plan.md, Phase B part 2.
 */

import { FaceCheckCard } from './FaceCheckCard'

export function FaceVisibilityCard() {
    return (
        <FaceCheckCard
            title="Check Uncertain Faces"
            noun="uncertain face"
            description={<>
                Asks the vision model whether a clear face is visible in the faces the detector was unsure about, and uses the answers to improve
                <em> People &gt; Edge Cases &gt; Not a Face?</em>. It only ranks suggestions: nothing is ignored or changed by it.
                It uses the GPU (well under a second a face) and pauses for scans and AI work.
            </>}
        />
    )
}
