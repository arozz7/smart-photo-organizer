import { useState, useEffect } from 'react';
import { PersonNameInput } from '../PersonNameInput';

interface EditPersonNameModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentName: string;
    onRename: (newName: string) => void;
}

const EditPersonNameModal = ({
    isOpen,
    onClose,
    currentName,
    onRename
}: EditPersonNameModalProps) => {
    const [name, setName] = useState(currentName);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
            // Force focus fix
            if (window.focus) window.focus();
        }
    }, [isOpen, currentName]);

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
                <h3 className="text-xl font-bold text-white mb-4">Rename Person</h3>

                <div className="mb-6">
                    <label className="block text-gray-400 text-sm mb-2">New Name</label>
                    <PersonNameInput
                        autoFocus
                        value={name}
                        onChange={setName}
                        onCommit={() => name.trim() && onRename(name)}
                        placeholder="New Name"
                        className="w-full"
                        onSelect={(_id, selectedName) => setName(selectedName)}
                    // No descriptors for rename, just autocomplete which PersonNameInput handles by default
                    />
                    <p className="text-xs text-gray-500 mt-2">
                        Note: If this name belongs to another person, these two people will be <strong>merged</strong>. This cannot be undone.
                    </p>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onRename(name)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Rename
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditPersonNameModal;
