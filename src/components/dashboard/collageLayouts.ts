export interface CollageRect {
    x: number
    y: number
    w: number
    h: number
    photoIndex: number
}

export type LayoutMode = 'grid' | 'feature' | 'mosaic'

const DEFAULT_GAP = 8

function gridLayout(photoCount: number, canvasW: number, canvasH: number, gap: number): CollageRect[] {
    const cols = photoCount <= 4 ? 2 : 3
    const rows = Math.ceil(photoCount / cols)
    const cellW = (canvasW - gap * (cols + 1)) / cols
    const cellH = (canvasH - gap * (rows + 1)) / rows
    const rects: CollageRect[] = []

    for (let i = 0; i < photoCount; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        rects.push({
            x: gap + col * (cellW + gap),
            y: gap + row * (cellH + gap),
            w: cellW,
            h: cellH,
            photoIndex: i,
        })
    }
    return rects
}

function featureLayout(photoCount: number, canvasW: number, canvasH: number, gap: number): CollageRect[] {
    const rects: CollageRect[] = []
    const count = Math.min(photoCount, 4)
    const heroW = (canvasW - gap * 3) * 0.6
    const heroH = canvasH - gap * 2

    // Hero photo on the left
    rects.push({
        x: gap,
        y: gap,
        w: heroW,
        h: heroH,
        photoIndex: 0,
    })

    // Supporting photos stacked on the right
    const sideCount = count - 1
    if (sideCount <= 0) return rects

    const sideX = gap * 2 + heroW
    const sideW = canvasW - sideX - gap
    const sideH = (heroH - gap * (sideCount - 1)) / sideCount

    for (let i = 0; i < sideCount; i++) {
        rects.push({
            x: sideX,
            y: gap + i * (sideH + gap),
            w: sideW,
            h: sideH,
            photoIndex: i + 1,
        })
    }
    return rects
}

function mosaicLayout(photoCount: number, canvasW: number, canvasH: number, gap: number): CollageRect[] {
    const rects: CollageRect[] = []
    const count = Math.min(photoCount, 8)
    const cols = count <= 4 ? 2 : 3
    const colW = (canvasW - gap * (cols + 1)) / cols

    // Distribute photos across columns
    const columns: number[][] = Array.from({ length: cols }, () => [])
    for (let i = 0; i < count; i++) {
        columns[i % cols].push(i)
    }

    // Assign variable heights within each column
    const heightRatios = [1.0, 0.7, 1.3, 0.85, 1.15, 0.9, 1.1, 0.75]

    for (let c = 0; c < cols; c++) {
        const items = columns[c]
        const totalRatio = items.reduce((sum, idx) => sum + heightRatios[idx % heightRatios.length], 0)
        const availH = canvasH - gap * (items.length + 1)
        let currentY = gap

        for (const idx of items) {
            const ratio = heightRatios[idx % heightRatios.length]
            const h = (ratio / totalRatio) * availH
            rects.push({
                x: gap + c * (colW + gap),
                y: currentY,
                w: colW,
                h,
                photoIndex: idx,
            })
            currentY += h + gap
        }
    }
    return rects
}

export function computeLayout(
    mode: LayoutMode,
    photoCount: number,
    canvasW: number,
    canvasH: number,
    gap = DEFAULT_GAP,
): CollageRect[] {
    switch (mode) {
        case 'grid':
            return gridLayout(photoCount, canvasW, canvasH, gap)
        case 'feature':
            return featureLayout(photoCount, canvasW, canvasH, gap)
        case 'mosaic':
            return mosaicLayout(photoCount, canvasW, canvasH, gap)
    }
}

export function photoCountForMode(mode: LayoutMode, large = false): number {
    switch (mode) {
        case 'grid':
            return large ? 9 : 4
        case 'feature':
            return 4
        case 'mosaic':
            return large ? 8 : 6
    }
}
