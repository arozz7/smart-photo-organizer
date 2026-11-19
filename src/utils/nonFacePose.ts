/** A face turned this far (either way) is usually a real face seen from the side. */
export const TURNED_DEGREES = 45

/** What the tile says about the pose: an unknown pose is shown as unknown, never as facing front. */
export function describePose(yaw: number | null): { text: string; turned: boolean } {
    if (yaw === null) return { text: 'pose unknown', turned: false }
    const degrees = Math.round(Math.abs(yaw))
    const turned = degrees >= TURNED_DEGREES
    return { text: turned ? `${degrees}° turned` : `${degrees}°`, turned }
}
