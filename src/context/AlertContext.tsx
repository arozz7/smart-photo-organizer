import React, { createContext, useContext, useState, ReactNode } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';

interface AlertOptions {
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'primary' | 'danger';
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
    showCancel?: boolean;
}

interface AlertContextType {
    showAlert: (options: AlertOptions) => void;
    showConfirm: (options: AlertOptions) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
    const context = useContext(AlertContext);
    if (!context) throw new Error('useAlert must be used within AlertProvider');
    return context;
};

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [modal, setModal] = useState<(AlertOptions & { open: boolean }) | null>(null);

    const showAlert = (options: AlertOptions) => {
        setModal({
            ...options,
            open: true,
            showCancel: false,
            confirmLabel: options.confirmLabel || 'OK'
        });
    };

    const showConfirm = (options: AlertOptions) => {
        setModal({
            ...options,
            open: true,
            showCancel: true,
            confirmLabel: options.confirmLabel || 'Confirm',
            cancelLabel: options.cancelLabel || 'Cancel'
        });
    };

    const handleConfirm = async () => {
        if (modal?.onConfirm) {
            await modal.onConfirm();
        }
        setModal(null);
        // Ensure window focus restoration in Electron
        // @ts-ignore
        if (window.ipcRenderer) window.ipcRenderer.invoke('app:focusWindow');
    };

    const handleCancel = () => {
        if (modal?.onCancel) {
            modal.onCancel();
        }
        setModal(null);
        // Ensure window focus restoration in Electron
        // @ts-ignore
        if (window.ipcRenderer) window.ipcRenderer.invoke('app:focusWindow');
    };

    return (
        <AlertContext.Provider value={{ showAlert, showConfirm }}>
            {children}
            {modal && (
                <ConfirmationModal
                    open={modal.open}
                    onOpenChange={(open) => !open && handleCancel()}
                    title={modal.title}
                    description={modal.description}
                    confirmLabel={modal.confirmLabel || 'OK'}
                    cancelLabel={modal.showCancel ? modal.cancelLabel : undefined}
                    onConfirm={handleConfirm}
                    variant={modal.variant}
                />
            )}
        </AlertContext.Provider>
    );
};
