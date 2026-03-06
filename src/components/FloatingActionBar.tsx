import React from 'react';

interface FloatingActionBarProps {
    selectedCount: number;
    onClearSelection: () => void;
    children: React.ReactNode;
}

export function FloatingActionBar({ selectedCount, onClearSelection, children }: FloatingActionBarProps) {
    if (selectedCount === 0) return null;

    return (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-gray-900/95 border border-gray-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-sticky animate-in slide-in-from-bottom-4 fade-in duration-200 backdrop-blur-md">
            <div className="text-sm font-medium text-white border-r border-gray-700 pr-4 whitespace-nowrap">
                {selectedCount} selected
            </div>

            <div className="flex items-center gap-4">
                {children}
            </div>

            <div className="border-l border-gray-700 pl-4">
                <button
                    onClick={onClearSelection}
                    className="text-xs text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

interface ActionButtonProps {
    onClick: () => void;
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
    variant?: 'default' | 'primary' | 'danger' | 'success';
    loading?: boolean;
}

export function FloatingActionButton({
    onClick,
    label,
    icon,
    disabled,
    variant = 'default',
    loading
}: ActionButtonProps) {
    const variants = {
        default: 'text-indigo-400 hover:text-indigo-300',
        primary: 'text-indigo-400 hover:text-indigo-300',
        danger: 'text-red-400 hover:text-red-300',
        success: 'text-green-400 hover:text-green-300'
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled || loading}
            className={`text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 ${variants[variant]}`}
        >
            {loading ? (
                <div className={`animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full`} />
            ) : icon}
            {label}
        </button>
    );
}
