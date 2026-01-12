import React from 'react';

interface ClusterToolbarProps {
    // Selection state
    selectedCount: number;
    totalCount: number;
    onSelectAll: () => void;
    onClearSelection: () => void;

    // Filter state
    sizeFilter: 'all' | 'large' | 'medium' | 'small';
    onSizeFilterChange: (filter: 'all' | 'large' | 'medium' | 'small') => void;
    filteredCount: number;

    // Actions
    children?: React.ReactNode; // For dynamic action buttons (e.g. Ignore, Confirm)

    // Optional override for keyboard hints if they differ contextually
    keyboardHints?: React.ReactNode;
}

export function ClusterToolbar({
    selectedCount,
    totalCount,
    onSelectAll,
    onClearSelection,
    sizeFilter,
    onSizeFilterChange,
    filteredCount,
    children,
    keyboardHints
}: ClusterToolbarProps) {
    const isAllSelected = selectedCount > 0 && selectedCount >= filteredCount;

    return (
        <div className="space-y-4">
            {/* Top Row: Filters & Hints */}
            <div className="flex items-center justify-between gap-4 py-2 px-3 bg-gray-800/30 border border-gray-700/50 rounded-lg text-xs">
                {/* Left: Keyboard hints */}
                <div className="flex items-center gap-2 text-indigo-300 whitespace-nowrap overflow-x-auto no-scrollbar">
                    {keyboardHints || (
                        <>
                            <span className="text-gray-400">
                                <kbd className="px-1 bg-gray-700/50 rounded">A</kbd> Accept ·
                                <kbd className="px-1 bg-gray-700/50 rounded">X</kbd> Ignore ·
                                <kbd className="px-1 bg-gray-700/50 rounded">N</kbd> Name ·
                                <kbd className="px-1 bg-gray-700/50 rounded">↑↓</kbd> Nav
                            </span>
                        </>
                    )}
                </div>

                {/* Right: Size Filters */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {(['all', 'large', 'medium', 'small'] as const).map((filter) => {
                        const labels: Record<string, string> = { all: 'All', large: '10+', medium: '5-9', small: '2-4' };
                        return (
                            <button
                                key={filter}
                                onClick={() => onSizeFilterChange(filter)}
                                className={`px-2 py-0.5 text-xs rounded border transition-colors ${sizeFilter === filter
                                    ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50'
                                    : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-300'
                                    }`}
                            >
                                {labels[filter]}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Bottom Row: Actions & Selection */}
            <div className="flex items-center justify-between bg-gray-800/30 p-4 rounded-xl border border-gray-800 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-400">
                        <span className="hidden sm:inline">Showing </span>
                        <span className="text-white font-medium">{filteredCount}</span>
                        <span className="hidden sm:inline"> groups</span>
                        {selectedCount > 0 && (
                            <span className="ml-2 text-indigo-300 font-medium">({selectedCount} selected)</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pl-2">
                    <button
                        onClick={() => isAllSelected ? onClearSelection() : onSelectAll()}
                        className={`px-3 py-1.5 text-sm border rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${selectedCount > 0
                            ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30'
                            : 'bg-gray-800/50 hover:bg-gray-700 text-gray-300 border-gray-700'
                            }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {isAllSelected ? 'Deselect All' : 'Select All'}
                    </button>

                    {/* Dynamic Action Buttons */}
                    {children}
                </div>
            </div>
        </div>
    );
}

// Button helper for consistent styling
export function ClusterToolbarButton({
    onClick,
    disabled,
    icon,
    label,
    variant = 'default'
}: {
    onClick: () => void,
    disabled?: boolean,
    icon?: React.ReactNode,
    label: string,
    variant?: 'default' | 'primary' | 'danger'
}) {
    const variants = {
        default: 'bg-gray-800/50 hover:bg-gray-700 text-gray-300 border-gray-700',
        primary: 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30',
        danger: 'bg-red-900/20 hover:bg-red-900/30 text-red-300 border-red-500/30'
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`px-3 py-1.5 text-sm border rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {icon}
            {label}
        </button>
    );
}
