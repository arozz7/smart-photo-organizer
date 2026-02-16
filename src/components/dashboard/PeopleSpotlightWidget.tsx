import { useNavigate } from 'react-router-dom'
import FaceThumbnail from '../FaceThumbnail'

interface TopPerson {
    id: number;
    name: string;
    face_count: number;
    cover_path: string | null;
    cover_box: string | null;
    cover_width: number | null;
    cover_height: number | null;
    entity_type: string;
}

interface PeopleSpotlightWidgetProps {
    people: TopPerson[];
}

export default function PeopleSpotlightWidget({ people }: PeopleSpotlightWidgetProps) {
    const navigate = useNavigate();

    if (people.length === 0) {
        return (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-white mb-2">People Spotlight</h3>
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                    <span className="text-3xl mb-3">👥</span>
                    <p className="text-sm">No named people yet. Head to People to get started!</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">People Spotlight</h3>
                <button
                    onClick={() => navigate('/people')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                    View all
                </button>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {people.map((person) => {
                    const box = person.cover_box ? JSON.parse(person.cover_box) : null;
                    return (
                        <button
                            key={person.id}
                            onClick={() => navigate(`/person/${person.id}`)}
                            className="flex-shrink-0 group cursor-pointer text-center"
                        >
                            <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-900 ring-2 ring-gray-700 group-hover:ring-indigo-500 transition-all">
                                {person.cover_path ? (
                                    <FaceThumbnail
                                        src={`local-resource://${encodeURIComponent(person.cover_path)}`}
                                        fallbackSrc={`local-resource://${encodeURIComponent(person.cover_path)}`}
                                        box={box}
                                        originalImageWidth={person.cover_width ?? undefined}
                                        useServerCrop={true}
                                        className="w-full h-full"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xl">
                                        {person.entity_type === 'pet' ? '🐾' : '👤'}
                                    </div>
                                )}
                            </div>
                            <div className="mt-1.5 max-w-[72px]">
                                <div className="text-xs text-gray-200 truncate font-medium">{person.name}</div>
                                <div className="text-[10px] text-gray-500">{person.face_count}</div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
