

export type EdgeCaseFilterType = 'unnamed' | 'ignored' | 'ungroupable' | 'background'

interface EdgeCaseFiltersProps {
    activeFilter: EdgeCaseFilterType
    onFilterChange: (filter: EdgeCaseFilterType) => void
    counts: {
        unnamed: number
        ungroupable: number
        ignored: number
        background: number
    }
    className?: string
}

export default function EdgeCaseFilters({ activeFilter, onFilterChange, counts, className = '' }: EdgeCaseFiltersProps) {
    const filters: { id: EdgeCaseFilterType; label: string; icon: JSX.Element; color: string }[] = [
        {
            id: 'unnamed',
            label: 'Review Needed',
            color: 'indigo',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
            )
        },
        {
            id: 'ungroupable',
            label: 'Ungroupable',
            color: 'gray',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
            )
        },
        {
            id: 'ignored',
            label: 'Ignored',
            color: 'red',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
            )
        },
        {
            id: 'background',
            label: 'Background',
            color: 'amber',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
            )
        }
    ]

    return (
        <div className={`flex items-center gap-2 p-1 bg-gray-900/50 backdrop-blur rounded-xl border border-gray-800 ${className}`}>
            {filters.map(filter => {
                const isActive = activeFilter === filter.id
                const count = counts[filter.id] || 0

                return (
                    <button
                        key={filter.id}
                        onClick={() => onFilterChange(filter.id)}
                        className={`
                            relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                            ${isActive
                                ? `bg-${filter.color}-500/10 text-${filter.color}-400 ring-1 ring-${filter.color}-500/50 shadow-lg shadow-${filter.color}-500/10`
                                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                            }
                        `}
                    >
                        {filter.icon}
                        <span>{filter.label}</span>
                        <span className={`
                            px-1.5 py-0.5 rounded-full text-[10px] font-bold min-w-[20px] text-center
                            ${isActive
                                ? `bg-${filter.color}-500/20 text-${filter.color}-300`
                                : 'bg-gray-800 text-gray-500 group-hover:bg-gray-700'
                            }
                        `}>
                            {count}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
