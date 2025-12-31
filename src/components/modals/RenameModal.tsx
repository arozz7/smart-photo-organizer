import { useState, useEffect } from 'react';

interface RenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (name: string) => void;
    initialValue: string;
    count: number;
}

const RenameModal = ({
    isOpen,
    onClose,
    onConfirm,
    initialValue,
    count
}: RenameModalProps) => {
    const [name, setName] = useState(initialValue);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [allPeopleNames, setAllPeopleNames] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            setName(initialValue);
            fetchPeople();
        }
    }, [isOpen, initialValue]);

    const fetchPeople = async () => {
        try {
            // @ts-ignore
            const people = await window.ipcRenderer.invoke('db:getPeople');
            setAllPeopleNames(people.map((p: any) => p.name));
        } catch (err) {
            console.error('Failed to fetch people', err);
        }
    };

    useEffect(() => {
        if (name.length > 0) {
            const filtered = allPeopleNames
                .filter(p => p.toLowerCase().includes(name.toLowerCase()) && p !== name)
                .slice(0, 50);
            setSuggestions(filtered);
        } else {
            setSuggestions(allPeopleNames.slice(0, 50));
        }
    }, [name, allPeopleNames]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
            onClick={onClose}
        >
            <div
                className="bg-gray-800 p-6 rounded-xl shadow-2xl w-full max-w-md border border-gray-700"
                onClick={e => e.stopPropagation()}
            >
                <h3 className="text-xl font-bold text-white mb-2">Move {count} Faces</h3>
                <p className="text-gray-400 mb-4 text-sm">Enter the name of the person to move these faces to.</p>

                <div className="relative mb-6">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Person Name"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') onConfirm(name);
                            if (e.key === 'Escape') onClose();
                        }}
                    />
                    {suggestions.length > 0 && (
                        <div className="bg-gray-800 border border-gray-700 mt-1 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
                            {suggestions.map((suggestion, idx) => (
                                <div
                                    key={idx}
                                    className="px-4 py-2 hover:bg-indigo-600 cursor-pointer text-gray-200"
                                    onClick={() => setName(suggestion)}
                                >
                                    {suggestion}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(name)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Move Faces
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RenameModal;
