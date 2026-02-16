import { useScan } from '../../context/ScanContext'

interface RecentPhoto {
    id: number;
    file_path: string;
    preview_cache_path: string | null;
    scan_timestamp: number;
}

interface RecentActivityWidgetProps {
    photos: RecentPhoto[];
}

export default function RecentActivityWidget({ photos }: RecentActivityWidgetProps) {
    const { viewPhoto } = useScan();

    if (photos.length === 0) {
        return (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-white mb-2">Recent Activity</h3>
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                    <span className="text-3xl mb-3">🔍</span>
                    <p className="text-sm">No scans yet. Start a scan to see activity here!</p>
                </div>
            </div>
        );
    }

    // Calculate "recently" scanned count (last hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = photos.filter(p => p.scan_timestamp > oneHourAgo).length;

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Recent Activity</h3>
                {recentCount > 0 && (
                    <span className="text-xs text-gray-400">{recentCount} scanned in the last hour</span>
                )}
            </div>

            <div className="grid grid-cols-4 gap-2">
                {photos.map((photo, index) => {
                    const imgPath = photo.preview_cache_path || photo.file_path;
                    return (
                        <button
                            key={photo.id}
                            onClick={() => viewPhoto(photo.id)}
                            className="aspect-square rounded-md overflow-hidden bg-gray-900 hover:ring-2 hover:ring-indigo-500 transition-all group cursor-pointer"
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            <img
                                src={`local-resource://${encodeURIComponent(imgPath)}?width=150`}
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
    );
}
