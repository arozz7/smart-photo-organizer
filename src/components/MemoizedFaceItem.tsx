import React, { memo } from 'react';
import { CheckIcon } from '@radix-ui/react-icons';
import FaceThumbnail from './FaceThumbnail';
import { BlurryFace } from '../types/index';

interface FaceItemProps {
    face: BlurryFace;
    isSelected: boolean;
    onToggle: (id: number) => void;
    onPreview: (face: BlurryFace) => void;
}

const FaceItem = ({ face, isSelected, onToggle, onPreview }: FaceItemProps) => {
    return (
        <div
            className={`relative group w-full h-full rounded-md overflow-hidden cursor-pointer border-2 transition-all ${isSelected ? 'border-red-500 opacity-100 ring-2 ring-red-500/50' : 'border-transparent opacity-80 hover:opacity-100'}`}
            onClick={() => onToggle(face.id)}
        >
            <FaceThumbnail
                src={face.preview_cache_path
                    ? `local-resource://${encodeURIComponent(face.preview_cache_path)}?box=${face.box.x},${face.box.y},${face.box.width},${face.box.height}&originalWidth=${face.original_width || 0}&width=200`
                    : `local-resource://${encodeURIComponent(face.file_path || '')}?box=${face.box.x},${face.box.y},${face.box.width},${face.box.height}&originalWidth=${face.original_width || 0}&width=200`}
                fallbackSrc={`local-resource://${encodeURIComponent(face.file_path || '')}?width=300`}
                box={face.box}
                originalImageWidth={face.original_width || 0}
                useServerCrop={true}
                className="w-full h-full object-cover"
            />

            <div className="absolute top-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-bl backdrop-blur-sm">
                {face.blur_score?.toFixed(1)}
            </div>

            {face.person_name && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] px-1 py-0.5 truncate text-center backdrop-blur-sm">
                    {face.person_name}
                </div>
            )}

            {!isSelected && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onPreview(face);
                    }}
                    className="absolute bottom-1 right-1 bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all z-10"
                    title="View Original Photo"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                    </svg>
                </button>
            )}

            {/* Selection Checkmark Overlay */}
            {isSelected && (
                <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                    <div className="bg-red-500 text-white rounded-full p-1 shadow-lg">
                        <CheckIcon className="w-6 h-6" />
                    </div>
                </div>
            )}
        </div>
    );
};

export const MemoizedFaceItem = memo(FaceItem);
