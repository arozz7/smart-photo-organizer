
import { usePeople } from '../context/PeopleContext';

interface SmartIgnorePanelProps {
    onFilterBackground: () => void;
    onIgnoreAllGroups: () => void;
    stats?: {
        autoIgnored: number;
        backgroundIdentified: number;
        pendingReview: number;
    };
}

export default function SmartIgnorePanel({ onFilterBackground, onIgnoreAllGroups, stats }: SmartIgnorePanelProps) {
    const { smartIgnoreSettings } = usePeople();

    if (!smartIgnoreSettings) return null;

    return (
        <div className="flex items-center justify-between bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-2.5 mb-4">
            {/* Left: Title & Stats */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-base">🎯</span>
                    <span className="text-sm font-medium text-gray-200">Smart Ignore</span>
                </div>
                {stats && (
                    <div className="flex items-center gap-4 text-xs text-gray-400 border-l border-gray-700 pl-4">
                        <span>
                            <span className="text-green-400 font-medium">{stats.autoIgnored}</span> assigned
                        </span>
                        <span>
                            <span className="text-amber-400 font-medium">{stats.pendingReview}</span> to review
                        </span>
                    </div>
                )}
            </div>

            {/* Right: Quick Actions */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onFilterBackground}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-700/50 hover:bg-amber-900/30 text-gray-300 hover:text-amber-300 border border-gray-600 hover:border-amber-500/50 rounded-md transition-all"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                    </svg>
                    Filter BG
                </button>
                <button
                    onClick={onIgnoreAllGroups}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-500 rounded-md transition-all"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    Ignore All
                </button>
            </div>
        </div>
    );
}
