

export type EdgeCaseFilterType = 'unnamed' | 'ignored' | 'ungroupable' | 'background' | 'nonface' | 'profile'

type FilterColor = 'indigo' | 'gray' | 'red' | 'amber' | 'orange' | 'sky'

// Written out in full: Tailwind only generates the classes it can read in the source, so `bg-${color}-500/10` produced nothing.
const ACTIVE_CLASSES: Record<FilterColor, { tab: string; badge: string }> = {
    indigo: { tab: 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/50 shadow-lg shadow-indigo-500/10', badge: 'bg-indigo-500/20 text-indigo-300' },
    gray: { tab: 'bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/50 shadow-lg shadow-gray-500/10', badge: 'bg-gray-500/20 text-gray-300' },
    red: { tab: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/50 shadow-lg shadow-red-500/10', badge: 'bg-red-500/20 text-red-300' },
    amber: { tab: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/50 shadow-lg shadow-amber-500/10', badge: 'bg-amber-500/20 text-amber-300' },
    orange: { tab: 'bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/50 shadow-lg shadow-orange-500/10', badge: 'bg-orange-500/20 text-orange-300' },
    sky: { tab: 'bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/50 shadow-lg shadow-sky-500/10', badge: 'bg-sky-500/20 text-sky-300' },
}

interface EdgeCaseFiltersProps {
    activeFilter: EdgeCaseFilterType
    onFilterChange: (filter: EdgeCaseFilterType) => void
    counts: {
        unnamed: number
        ungroupable: number
        ignored: number
        background: number
        nonface: number
        profile: number
        /** Faces Review Needed leaves out because the Not a Face? list holds them. */
        hidden?: number
    }
    className?: string
}

export default function EdgeCaseFilters({ activeFilter, onFilterChange, counts, className = '' }: EdgeCaseFiltersProps) {
    const filters: { id: EdgeCaseFilterType; label: string; title?: string; icon: JSX.Element; color: FilterColor }[] = [
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
        },
        {
            id: 'nonface',
            label: 'Not a Face?',
            title: 'Boxes the detector was unsure about (suggestions only; you decide)',
            color: 'orange',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            )
        },
        {
            id: 'profile',
            label: 'Turned faces',
            title: 'Faces seen from the side, with the person whose turned faces they resemble (suggestions only; you decide)',
            color: 'sky',
            icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
            )
        }
    ]

    const hidden = counts.hidden ?? 0

    return (
        <div className="space-y-2">
            <div className={`flex items-center gap-2 p-1 bg-gray-900/50 backdrop-blur rounded-xl border border-gray-800 ${className}`}>
                {filters.map(filter => {
                    const isActive = activeFilter === filter.id
                    const count = counts[filter.id] || 0

                    return (
                        <button
                            key={filter.id}
                            onClick={() => onFilterChange(filter.id)}
                            title={filter.title}
                            className={`
                                relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                                ${isActive
                                    ? ACTIVE_CLASSES[filter.color].tab
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                }
                            `}
                        >
                            {filter.icon}
                            <span>{filter.label}</span>
                            <span className={`
                                px-1.5 py-0.5 rounded-full text-[10px] font-bold min-w-[20px] text-center
                                ${isActive
                                    ? ACTIVE_CLASSES[filter.color].badge
                                    : 'bg-gray-800 text-gray-500 group-hover:bg-gray-700'
                                }
                            `}>
                                {count}
                            </span>
                        </button>
                    )
                })}
            </div>
            {activeFilter === 'unnamed' && hidden > 0 && (
                <div className="flex items-center justify-between gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-2 text-sm text-orange-200">
                    <span>
                        {hidden.toLocaleString('en-US')} {hidden === 1 ? 'face is' : 'faces are'} not shown here because {hidden === 1 ? 'it is' : 'they are'} in Not a Face? (faces turned 45° or more are never hidden).
                    </span>
                    <button onClick={() => onFilterChange('nonface')} className="shrink-0 font-medium text-orange-300 hover:text-white">Review them in Not a Face?</button>
                </div>
            )}
        </div>
    )
}
