
import { useState } from 'react'
import FaceThumbnail from './FaceThumbnail'

export default function PersonCard({ person, onClick }: { person: any, onClick: () => void }) {
    const box = person.cover_box ? JSON.parse(person.cover_box) : null;

    return (
        <div
            onClick={onClick}
            className="bg-gray-800 rounded-xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-indigo-500 transition-all group relative"
        >
            <div className="aspect-square bg-gray-900 overflow-hidden relative">
                {person.cover_path ? (
                    <FaceThumbnail
                        src={`local-resource://${encodeURIComponent(person.cover_path)}`}
                        box={box}
                        originalImageWidth={person.cover_width}
                        className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-500"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">
                        👤
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
