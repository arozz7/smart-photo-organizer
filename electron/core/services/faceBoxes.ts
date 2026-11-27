export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

function intersectionArea(a: FaceBox, b: FaceBox): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return Math.max(0, width) * Math.max(0, height);
}

/** Overlap divided by the area of both boxes together: 1 for the same box, 0 for boxes apart. */
export function boxIoU(a: FaceBox, b: FaceBox): number {
    const overlap = intersectionArea(a, b);
    const union = a.width * a.height + b.width * b.height - overlap;
    return union > 0 ? overlap / union : 0;
}

/** Overlap divided by the area of the smaller box: 1 when the small box lies fully inside the big one. */
export function boxIoMin(a: FaceBox, b: FaceBox): number {
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    return smaller > 0 ? intersectionArea(a, b) / smaller : 0;
}
