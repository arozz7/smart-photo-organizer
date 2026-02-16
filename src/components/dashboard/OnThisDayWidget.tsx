import { useMemo } from 'react'
import { useScan } from '../../context/ScanContext'

interface MemoryPhoto {
    id: number;
    file_path: string;
    preview_cache_path: string | null;
    created_at: string;
    year: number;
    width: number;
    height: number;
}

interface OnThisDayWidgetProps {
    memories: MemoryPhoto[];
}

export default function OnThisDayWidget({ memories }: OnThisDayWidgetProps) {
    const { viewPhoto } = useScan();

    // Group photos by year
    const groupedByYear = useMemo(() => {
        const groups = new Map<number, MemoryPhoto[]>();
        for (const photo of memories) {
            const year = photo.year;
            if (!groups.has(year)) groups.set(year, []);
            groups.get(year)!.push(photo);
        }
        // Sort years descending
        return Array.from(groups.entries()).sort(([a], [b]) => b - a);
    }, [memories]);

    if (memories.length === 0) {
        return (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-white mb-2">On This Day</h3>
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                    <span className="text-3xl mb-3">📅</span>
                    <p className="text-sm">No memories for today. Check back tomorrow!</p>
                </div>
            </div>
        );
    }

    const today = new Date();
    const monthDay = today.toLocaleDateString('default', { month: 'long', day: 'numeric' });

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">On This Day</h3>
                <span className="text-sm text-gray-400">{monthDay}</span>
            </div>

            <div className="space-y-4">
                {groupedByYear.map(([year, photos]) => (
                    <div key={year}>
                        <h4 className="text-sm font-medium text-indigo-400 mb-2">{year}</h4>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                            {photos.map((photo) => {
                                const imgPath = photo.preview_cache_path || photo.file_path;
                                return (
                                    <button
                                        key={photo.id}
                                        onClick={() => viewPhoto(photo.id)}
                                        className="flex-shrink-0 w-24 h-24 rounded-md overflow-hidden bg-gray-900 hover:ring-2 hover:ring-indigo-500 transition-all group cursor-pointer"
                                    >
                                        <img
                                            src={`local-resource://${encodeURIComponent(imgPath)}?width=200`}
                                            alt=""
                                            loading="lazy"
                                            decoding="async"
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
