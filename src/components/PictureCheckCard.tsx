/**
 * PictureCheckCard
 *
 * Asks the vision model whether each face is a real person or only a picture of one (a billboard, poster, framed photo, screen, statue or toy):
 * the faces already assigned to people first, then the review queue. The answers fill Edge Cases > Pictures?; the check itself never ignores or
 * changes a face. See docs/plans/pictures-suggestions-plan.md, Phase C.
 */

import { FaceCheckCard } from './FaceCheckCard'

export function PictureCheckCard() {
    return (
        <FaceCheckCard
            title="Check for Pictures of Faces"
            noun="face"
            channelPrefix="picturecheck"
            description={<>
                Asks the vision model whether each face is a real person or only a picture of one (a billboard, poster, framed photo, screen, statue or toy),
                faces assigned to people first, then the review queue, and uses the answers for <em>People &gt; Edge Cases &gt; Pictures?</em>.
                It only ranks suggestions: nothing is ignored or changed by it. It uses the GPU (about two thirds of a second a face, so a whole library takes
                many hours) and pauses for scans and AI work.
            </>}
        />
    )
}
