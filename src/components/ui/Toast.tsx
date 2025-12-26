import React, { useEffect, useState } from 'react';

interface ToastProps {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning' | 'loading';
    title?: string;
    description: string;
    onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({ type, title, description, onDismiss }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Trigger enter animation
        requestAnimationFrame(() => setIsVisible(true));
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
        setTimeout(onDismiss, 300); // Wait for exit animation
    };

    const icons = {
        success: (
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
        ),
        error: (
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        ),
        info: (
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        warning: (
            <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        ),
        loading: (
            <svg className="w-5 h-5 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        ),
    };

    const bgColors = {
        success: 'bg-green-900/10 border-green-500/20',
        error: 'bg-red-900/10 border-red-500/20',
        info: 'bg-blue-900/10 border-blue-500/20',
        warning: 'bg-yellow-900/10 border-yellow-500/20',
        loading: 'bg-indigo-900/10 border-indigo-500/20',
    };

    return (
        <div
            className={`
                min-w-[300px] max-w-sm w-full backdrop-blur-md rounded-lg border p-4 shadow-lg transition-all duration-300 transform
                ${bgColors[type] || 'bg-gray-800 border-gray-700'}
                ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-[100%] opacity-0'}
            `}
        >
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 pt-0.5">
                    {icons[type]}
                </div>
                <div className="flex-1 pt-0.5">
                    {title && <h3 className="text-sm font-medium text-white mb-1">{title}</h3>}
                    <p className="text-sm text-gray-300">{description}</p>
                </div>
                {type !== 'loading' && (
                    <button
                        onClick={handleDismiss}
                        className="flex-shrink-0 ml-4 text-gray-400 hover:text-white transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
};
