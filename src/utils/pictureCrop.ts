/** How many times the face box's longer side the picture list shows around the face: the frame, poster or screen has to be in view. */
export const SURROUNDING_MULTIPLIER = 3.5

interface Box {
    x: number
    y: number
    width: number
    height: number
}

/**
 * The box to show for a face on the Pictures? list: a square around the face, `SURROUNDING_MULTIPLIER` times its longer side (the same view the model
 * had), kept inside the photo when its size is known. The face box itself is the wrong view for this list: a picture of a face looks like a face until
 * the frame around it is seen.
 */
export function surroundingBox(box: Box, photoWidth: number | null, photoHeight: number | null): Box {
    const side = Math.max(box.width, box.height) * SURROUNDING_MULTIPLIER
    if (!(side > 0)) return box
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    let x = cx - side / 2
    let y = cy - side / 2
    let width = side
    let height = side
    if (photoWidth !== null && photoHeight !== null) {
        const left = Math.max(0, x)
        const top = Math.max(0, y)
        const right = Math.min(photoWidth, x + width)
        const bottom = Math.min(photoHeight, y + height)
        if (right > left && bottom > top) {
            x = left
            y = top
            width = right - left
            height = bottom - top
        }
    }
    return { x, y, width, height }
}
