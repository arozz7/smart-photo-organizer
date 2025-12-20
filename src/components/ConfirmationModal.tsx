import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface ConfirmationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel?: string;
    onConfirm: () => void;
    variant?: 'danger' | 'primary';
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel = 'Cancel',
    onConfirm,
    variant = 'primary'
}) => {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200]" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl z-[201] animate-in fade-in zoom-in duration-200">
                    <Dialog.Title className="text-xl font-bold text-white mb-2">
                        {title}
                    </Dialog.Title>
                    <Dialog.Description className="text-gray-400 mb-6 leading-relaxed">
                        {description}
                    </Dialog.Description>

                    <div className="flex justify-end gap-3">
                        {cancelLabel && (
                            <Dialog.Close asChild>
                                <button className="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:text-white transition-colors">
                                    {cancelLabel}
                                </button>
                            </Dialog.Close>
                        )}
                        <button
                            onClick={() => {
                                onConfirm();
                                onOpenChange(false);
                            }}
                            className={`px-6 py-2 rounded-md text-white font-medium transition-all shadow-lg ${variant === 'danger'
                                ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20'
                                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20'
                                }`}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default ConfirmationModal;
