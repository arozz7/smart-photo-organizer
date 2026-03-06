interface EmptyStateProps {
    icon: React.ReactNode
    title: string
    description: string
    action?: {
        label: string
        onClick: () => void
    }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-8">
            <div className="text-gray-600 mb-4">{icon}</div>
            <h3 className="text-lg font-semibold text-gray-300 mb-2">{title}</h3>
            <p className="text-sm text-gray-500 max-w-md mb-6">{description}</p>
            {action && (
                <button
                    onClick={action.onClick}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
                >
                    {action.label}
                </button>
            )}
        </div>
    )
}
