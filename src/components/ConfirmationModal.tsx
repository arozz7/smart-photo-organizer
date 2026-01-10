import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface ConfirmationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel?: string;
    onConfirm: (val?: string) => void | Promise<void>;
    variant?: 'danger' | 'primary';
    defaultValue?: string;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel = 'Cancel',
    onConfirm,
    variant = 'primary',
    defaultValue
}) => {
    const [isLoading, setIsLoading] = React.useState(false);
    const [inputValue, setInputValue] = React.useState(defaultValue || '');

    // Refs for focus management
    const inputRef = React.useRef<HTMLInputElement>(null);
    const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

    // Focus appropriate element on open
    React.useEffect(() => {
        if (open) {
            if (defaultValue !== undefined) {
                setInputValue(defaultValue);
                setTimeout(() => inputRef.current?.focus(), 100);
            } else {
                // Focus confirm button for non-prompt modals
                setTimeout(() => confirmButtonRef.current?.focus(), 100);
            }
        }
    }, [open, defaultValue]);

    const handleConfirm = async () => {
        setIsLoading(true);
        try {
            await onConfirm(defaultValue !== undefined ? inputValue : undefined);
        } finally {
            if (open) setIsLoading(false);
        }
    };

    // Handle keyboard events on the modal content
    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Stop propagation to prevent page-level keyboard handlers
        e.stopPropagation();

        if (e.key === 'Enter' && !isLoading) {
            e.preventDefault();
            handleConfirm();
        } else if (e.key === 'Escape' && !isLoading) {
            e.preventDefault();
            onOpenChange(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200]" />
                <Dialog.Content
                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl z-[201] animate-in fade-in zoom-in duration-200"
                    onKeyDown={handleKeyDown}
                >
                    <Dialog.Title className="text-xl font-bold text-white mb-2">
                        {title}
                    </Dialog.Title>
                    <Dialog.Description className="text-gray-400 mb-6 leading-relaxed">
                        {description}
                    </Dialog.Description>

                    {defaultValue !== undefined && (
                        <input
                            ref={inputRef}
                            type="text"
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 mb-6 text-white focus:outline-none focus:border-indigo-500"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.stopPropagation();
                                    handleConfirm();
                                }
                            }}
                        />
                    )}

                    <div className="flex justify-end gap-3">
                        {cancelLabel && !isLoading && (
                            <Dialog.Close asChild>
                                <button className="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:text-white transition-colors">
                                    {cancelLabel}
                                </button>
                            </Dialog.Close>
                        )}
                        <button
                            ref={confirmButtonRef}
                            disabled={isLoading}
                            onClick={handleConfirm}
                            className={`px-6 py-2 rounded-md text-white font-medium transition-all shadow-lg flex items-center gap-2 ${variant === 'danger'
                                ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20 disabled:bg-red-600/50'
                                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20 disabled:bg-indigo-600/50'
                                }`}
                        >
                            {isLoading && <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                            {isLoading ? 'Processing...' : confirmLabel}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default ConfirmationModal;
