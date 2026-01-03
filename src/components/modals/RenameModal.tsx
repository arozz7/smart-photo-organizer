import { useState, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

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
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setName(initialValue);
            setSelectedIndex(-1);
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
            setSelectedIndex(-1);
        } else {
            setSuggestions(allPeopleNames.slice(0, 50));
        }
    }, [name, allPeopleNames]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') return; // Let Dialog handle it

        if (suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % suggestions.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                setName(suggestions[selectedIndex]);
                setSelectedIndex(-1);
            } else {
                onConfirm(name);
            }
        }
    };

    // Auto-scroll to selected item
    useEffect(() => {
        if (selectedIndex >= 0 && scrollRef.current) {
            const selectedElement = scrollRef.current.children[selectedIndex] as HTMLElement;
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    return (
        <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] animate-fade-in" />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md z-[101] animate-scale-in flex flex-col max-h-[80vh]"
                >
                    {/* Header - Fixed */}
                    <div className="flex-none p-6 pb-4">
                        <Dialog.Title className="text-xl font-bold text-white mb-2">
                            {count > 0 ? `Move ${count} Faces` : 'Rename Person'}
                        </Dialog.Title>
                        <Dialog.Description className="text-gray-400 text-sm">
                            {count > 0
                                ? 'Enter the name of the person to move these faces to.'
                                : 'Enter the new name for this person.'}
                        </Dialog.Description>
                    </div>

                    {/* Input + Suggestions - Scrollable middle */}
                    <div className="flex-1 min-h-0 px-6 flex flex-col">
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Person Name"
                            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none placeholder-gray-500 flex-none"
                            autoFocus
                        />
                        {suggestions.length > 0 && (
                            <div
                                className="mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-y-auto custom-scrollbar flex-1 min-h-0 max-h-40"
                                ref={scrollRef}
                            >
                                {suggestions.map((suggestion, idx) => (
                                    <div
                                        key={idx}
                                        className={`px-4 py-2 cursor-pointer transition-colors ${idx === selectedIndex
                                            ? 'bg-indigo-600 text-white'
                                            : 'text-gray-200 hover:bg-gray-700'
                                            }`}
                                        onClick={() => {
                                            setName(suggestion);
                                            setSelectedIndex(-1);
                                        }}
                                    >
                                        {suggestion}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer - Fixed */}
                    <div className="flex-none p-6 pt-4 flex justify-end gap-3 border-t border-gray-800 mt-4">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg hover:bg-gray-800 text-gray-300 transition-colors border border-transparent hover:border-gray-700"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onConfirm(name)}
                            disabled={!name.trim()}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {count > 0 ? 'Move Faces' : 'Rename'}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default RenameModal;
