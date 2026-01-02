import React, { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import FaceThumbnail from './FaceThumbnail';
import { usePeople } from '../context/PeopleContext';

interface GroupNamingModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    faces: any[];
    onConfirm: (selectedIds: number[], name: string) => Promise<void>;
    people?: any[]; // Optional for now to avoid breaking other usages if any
}

const GroupNamingModal: React.FC<GroupNamingModalProps> = ({ open, onOpenChange, faces, onConfirm, people = [] }) => {
    const { matchBatch } = usePeople();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(faces.map(f => f.id)));
    const [suggestion, setSuggestion] = useState<any>(null);
    const [name, setName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset selection and force focus when opening
    useEffect(() => {
        if (open) {
            setSelectedIds(new Set(faces.map(f => f.id)));
            setName('');
            setSuggestion(null);

            // Fetch suggestion
            const sample = faces.slice(0, 5).map(f => f.descriptor).filter(Boolean);
            if (sample.length > 0) {
                matchBatch(sample).then(results => {
                    const counts: any = {};
                    results.forEach(r => {
                        if (r && r.personId) {
                            if (!counts[r.personId]) counts[r.personId] = { person: r, count: 0 };
                            counts[r.personId].count++;
                        }
                    });
                    const winner = Object.values(counts).sort((a: any, b: any) => b.count - a.count)[0] as any;
                    if (winner) setSuggestion(winner.person);
                });
            }

            // Electronic workaround: ensure window focus before targeting input
            if (window.focus) window.focus();

            const timer = setTimeout(() => {
                if (inputRef.current) inputRef.current.focus();
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [open, faces]);

    // Handle window focus events to restore input focus if modal is active
    useEffect(() => {
        if (!open) return;

        const handleWindowFocus = () => {
            // Explicitly request app window focus in Electron first
            // @ts-ignore
            if (window.ipcRenderer) window.ipcRenderer.invoke('app:focusWindow');
            if (inputRef.current) inputRef.current.focus();
        };

        window.addEventListener('focus', handleWindowFocus);
        return () => window.removeEventListener('focus', handleWindowFocus);
    }, [open]);

    const toggleSelection = (id: number) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || selectedIds.size === 0) return;

        setIsSubmitting(true);
        try {
            await onConfirm(Array.from(selectedIds), name);
            onOpenChange(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-4xl max-h-[85vh] bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl z-50 flex flex-col">
                    <Dialog.Title className="text-xl font-bold text-white mb-2">
                        Name Group
                    </Dialog.Title>
                    <Dialog.Description className="text-gray-400 mb-4 text-sm">
                        Assign a name to the selected faces.
                    </Dialog.Description>

                    <div className="flex-1 overflow-y-auto mb-6 custom-scrollbar pr-2">
                        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
                            {faces.map(face => (
                                <div
                                    key={face.id}
                                    className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${selectedIds.has(face.id) ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-gray-700 opacity-50 grayscale'}`}
                                    onClick={() => toggleSelection(face.id)}
                                >
                                    <FaceThumbnail
                                        src={`local-resource://${encodeURIComponent(face.file_path)}`}
                                        fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                                        box={face.box}
                                        originalImageWidth={face.width}
                                        useServerCrop={true}
                                        className="w-full h-full object-cover"
                                    />
                                    {selectedIds.has(face.id) && (
                                        <div className="absolute top-1 right-1 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center shadow-sm">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="flex gap-4 items-end border-t border-gray-800 pt-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-400 mb-1">
                                Who is this? ({selectedIds.size} faces selected)
                            </label>
                            <input
                                ref={inputRef}
                                list="people-suggestions"
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Enter name..."
                                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                autoFocus
                            />
                            <datalist id="people-suggestions">
                                {people.map((p: any) => (
                                    <option key={p.id} value={p.name} />
                                ))}
                            </datalist>

                            {suggestion && (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Suggested:</span>
                                    <button
                                        type="button"
                                        onClick={() => setName(suggestion.personName)}
                                        className="bg-green-600/20 hover:bg-green-600/40 border border-green-500/30 text-green-300 px-2 py-1 rounded text-xs transition-all flex items-center gap-1.5 animate-fade-in group"
                                    >
                                        <span className="font-bold underline">{suggestion.personName}</span>
                                        <span className="text-[10px] opacity-60 group-hover:opacity-100">Click to use</span>
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || selectedIds.size === 0 || isSubmitting}
                            className="px-6 py-2 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-indigo-900/20"
                        >
                            {isSubmitting ? 'Saving...' : 'Confirm & Save'}
                        </button>
                    </form>

                    <Dialog.Close asChild>
                        <button className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
                            <Cross2Icon />
                        </button>
                    </Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default GroupNamingModal;
