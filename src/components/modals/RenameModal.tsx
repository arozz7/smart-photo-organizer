import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { PersonNameInput } from '../PersonNameInput';
import { usePeople } from '../../context/PeopleContext';

interface RenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (name: string) => void;
    initialValue: string;
    count: number;
    faceIds?: number[];
}

const RenameModal = ({
    isOpen,
    onClose,
    onConfirm,
    initialValue,
    count,
    faceIds
}: RenameModalProps) => {
    const [name, setName] = useState(initialValue);
    const [descriptors, setDescriptors] = useState<number[][] | undefined>(undefined);
    const { fetchFacesByIds } = usePeople();

    useEffect(() => {
        if (isOpen) {
            setName(initialValue);
            setDescriptors(undefined);

            if (faceIds && faceIds.length > 0) {
                fetchFacesByIds(faceIds.slice(0, 5)).then(faces => {
                    const descs = faces.map(f => f.descriptor).filter(d => !!d) as number[][];
                    if (descs.length > 0) {
                        setDescriptors(descs);
                    }
                });
            }
        }
    }, [isOpen, initialValue, faceIds, fetchFacesByIds]);

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
                    <div className="flex-1 min-h-0 px-6 flex flex-col pt-2">
                        <PersonNameInput
                            autoFocus
                            value={name}
                            onChange={setName}
                            onCommit={() => name.trim() && onConfirm(name)}
                            descriptors={descriptors}
                            placeholder="Person Name"
                            className="w-full"
                            onSelect={(_id, selectedName) => {
                                setName(selectedName);
                            }}
                        />
                        <div className='flex-1 pb-4'></div>
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
