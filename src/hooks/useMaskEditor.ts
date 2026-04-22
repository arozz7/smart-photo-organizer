import { useState, useCallback } from 'react'

export type BrushMode = 'paint' | 'erase'

export function useMaskEditor() {
    const [brushSize, setBrushSize] = useState(12)
    const [brushMode, setBrushMode] = useState<BrushMode>('erase')

    const toggleBrushMode = useCallback(() => {
        setBrushMode(m => m === 'paint' ? 'erase' : 'paint')
    }, [])

    return { brushSize, setBrushSize, brushMode, toggleBrushMode }
}
