import { useScan } from '../context/ScanContext'
// import { useAI } from '../context/AIContext'
import AIStatus from './AIStatus'

export default function StatusBar() {
    const { photos, filter, scanning, hasMore } = useScan()
    // const { processingQueue } = useAI() // Not needed if using AIStatus component internally

    let filterText = 'All Photos'
    if (filter.initial) filterText = 'Ready'
    else if (filter.untagged) filterText = 'Untagged'
    else if (filter.tag) filterText = `Tag: ${filter.tag}`
    else if (filter.folder) filterText = `Folder: ${filter.folder}`

    return (
        <footer className="h-8 bg-gray-800 border-t border-gray-700 flex items-center px-4 text-xs text-gray-400 select-none shrink-0 gap-4">
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${scanning ? 'bg-indigo-500 animate-pulse' : 'bg-gray-600'}`} />
                <span>{scanning ? 'Scanning...' : 'Ready'}</span>
            </div>

            <div className="w-px h-4 bg-gray-700" />

            <div className="flex items-center gap-1">
                <span className="font-medium text-gray-300">{filterText}</span>
                {photos.length > 0 && (
                    <span>
                        ({photos.length} item{photos.length !== 1 ? 's' : ''}{hasMore ? '+' : ''})
                    </span>
                )}
            </div>

            <div className="ml-auto flex items-center gap-4">
                <AIStatus />
            </div>
        </footer>
    )
}
