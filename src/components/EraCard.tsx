import { useState } from 'react';

interface EraCardProps {
    era: {
        id: number;
        era_name: string;
        user_name?: string;
        face_count: number;
        start_year?: number;
        end_year?: number;
    };
    onDelete: () => void;
    onRename: (eraId: number, newName: string) => Promise<void>;
}

const EraCard = ({ era, onDelete, onRename }: EraCardProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(era.user_name || era.era_name);
    const [isSaving, setIsSaving] = useState(false);

    const displayName = era.user_name || era.era_name;

    const handleSave = async () => {
        if (!editName.trim() || editName.trim() === displayName) {
            setIsEditing(false);
            return;
        }
        setIsSaving(true);
        try {
            await onRename(era.id, editName.trim());
            setIsEditing(false);
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setEditName(displayName);
            setIsEditing(false);
        }
    };

    return (
        <div className="bg-gray-900 border border-gray-600 rounded-lg p-3 flex items-center gap-3 min-w-[200px]">
            <div className="flex-1">
                {isEditing ? (
                    <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={handleSave}
                        autoFocus
                        disabled={isSaving}
                        className="w-full bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                ) : (
                    <div
                        className="font-bold text-white cursor-pointer hover:text-indigo-300 transition-colors"
                        onClick={() => setIsEditing(true)}
                        title="Click to rename"
                    >
                        {displayName}
                    </div>
                )}
                <div className="text-xs text-gray-400">
                    {era.face_count} faces
                    {era.start_year && ` • ${era.start_year}-${era.end_year}`}
                </div>
            </div>

            {!isEditing && (
                <>
                    <button
                        onClick={() => setIsEditing(true)}
                        className="text-gray-500 hover:text-indigo-400 p-1 rounded hover:bg-gray-800 transition-colors"
                        title="Rename Era"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                    </button>
                    <button
                        onClick={onDelete}
                        className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-gray-800 transition-colors"
                        title="Delete Era"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </>
            )}
        </div>
    );
};

export default EraCard;
