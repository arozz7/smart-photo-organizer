/**
 * AssignedCheckCard
 *
 * Asks the vision model "is a clear face visible?" about every face already assigned to a person, the person with the most faces first. The answers
 * fill the Doubtful faces list; the check itself never ignores or changes a face.
 */

import { FaceCheckCard } from './FaceCheckCard'

export function AssignedCheckCard() {
    return (
        <FaceCheckCard
            title="Check Assigned Faces"
            noun="face"
            channelPrefix="assignedcheck"
            description={<>
                Asks the vision model whether a clear face is visible in each face already assigned to a person (animals, objects, hands and pictures that ended up under a name),
                the person with the most faces first, and uses the answers for the <em>Doubtful faces</em> list.
                It only ranks suggestions: nothing is ignored or changed by it. It uses the GPU (about two thirds of a second a face, so a whole library takes
                many hours) and pauses for scans and AI work.
            </>}
        />
    )
}
