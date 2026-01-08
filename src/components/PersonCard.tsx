
import FaceThumbnail from './FaceThumbnail'

export default function PersonCard({ person, onClick }: { person: any, onClick: () => void }) {
    const box = person.cover_box ? JSON.parse(person.cover_box) : null;
    const hasUnconfirmed = person.unconfirmed_count > 0;
    const hasAlerts = person.alert_count > 0;

    return (
        <div
            onClick={onClick}
            className="bg-gray-800 rounded-xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-indigo-500 transition-all group relative"
        >
            <div className="aspect-square bg-gray-900 overflow-hidden relative">
                {person.cover_path ? (
                    <FaceThumbnail
                        src={`local-resource://${encodeURIComponent(person.cover_path)}`}
                        fallbackSrc={`local-resource://${encodeURIComponent(person.cover_path)}`}
                        box={box}
                        originalImageWidth={person.cover_width}
                        useServerCrop={true}
                        className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-500"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">
                        👤
                    </div>
                )}

                {/* Drift Alert indicator (top-left, red) */}
                {hasAlerts && (
                    <div
                        className="absolute top-2 left-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-lg"
                        title={`${person.alert_count} alert${person.alert_count !== 1 ? 's' : ''} - click to review`}
                    >
                        ⚠
                    </div>
                )}

                {/* New faces indicator badge (top-right, amber) */}
                {hasUnconfirmed && (
                    <div
                        className="absolute top-2 right-2 bg-amber-500 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold animate-pulse shadow-lg"
                        title={`${person.unconfirmed_count} unconfirmed face${person.unconfirmed_count !== 1 ? 's' : ''}`}
                    >
                        {person.unconfirmed_count > 99 ? '99+' : person.unconfirmed_count}
                    </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-0 left-0 p-4 w-full">
                    <h3 className="font-bold text-white truncate text-lg">{person.name}</h3>
                    <p className="text-gray-300 text-xs">{person.face_count} photos</p>
                </div>
            </div>
        </div>
    )
}
