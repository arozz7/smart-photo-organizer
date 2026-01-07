import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface ActionDropdownItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'default' | 'primary' | 'danger';
    loading?: boolean;
}

interface ActionDropdownProps {
    label: string;
    items: ActionDropdownItem[];
    className?: string;
    testId?: string;
}

/**
 * A reusable dropdown menu for grouping secondary actions.
 * Used to declutter headers with many action buttons.
 */
export const ActionDropdown: React.FC<ActionDropdownProps> = ({
    label,
    items,
    className = '',
    testId = 'action-dropdown'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Close on ESC key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
                buttonRef.current?.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    const handleItemClick = useCallback((item: ActionDropdownItem) => {
        if (item.disabled || item.loading) return;
        item.onClick();
        setIsOpen(false);
    }, []);

    const variantStyles = {
        default: 'text-gray-300 hover:text-white hover:bg-gray-700/50',
        primary: 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-600/10',
        danger: 'text-red-400 hover:text-red-300 hover:bg-red-600/10',
    };

    return (
        <div ref={dropdownRef} className={`relative ${className}`} data-testid={testId}>
            {/* Trigger Button */}
            <button
                ref={buttonRef}
                onClick={() => setIsOpen(!isOpen)}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
                data-testid={`${testId}-trigger`}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                {label}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div
                    className="absolute top-full right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden ring-1 ring-black ring-opacity-5 animate-in fade-in slide-in-from-top-1 duration-150"
                    role="menu"
                    data-testid={`${testId}-menu`}
                >
                    {items.map((item, index) => (
                        <button
                            key={index}
                            onClick={() => handleItemClick(item)}
                            disabled={item.disabled || item.loading}
                            className={`
                                w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3
                                ${variantStyles[item.variant || 'default']}
                                ${item.disabled || item.loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                            `}
                            role="menuitem"
                            data-testid={`${testId}-item-${index}`}
                        >
                            {item.loading ? (
                                <div className="h-4 w-4 animate-spin border-2 border-current border-t-transparent rounded-full" />
                            ) : item.icon ? (
                                <span className="h-4 w-4 flex-shrink-0">{item.icon}</span>
                            ) : null}
                            <span className="flex-1">{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ActionDropdown;
