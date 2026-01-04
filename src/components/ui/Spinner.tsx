import React from 'react';

interface SpinnerProps {
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const Spinner: React.FC<SpinnerProps> = ({ className = '', size = 'md' }) => {
    const sizeClasses = {
        sm: 'w-4 h-4 border-2',
        md: 'w-6 h-6 border-2',
        lg: 'w-8 h-8 border-4'
    };

    return (
        <div
            className={`animate-spin rounded-full border-gray-200 border-t-indigo-600 ${sizeClasses[size]} ${className}`}
            role="status"
            aria-label="loading"
        >
            <span className="sr-only">Loading...</span>
        </div>
    );
};
