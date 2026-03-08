import { PoseFilterMode } from '../hooks/usePoseFilter';

interface PoseFilterToggleProps {
    mode: PoseFilterMode;
    onModeChange: (mode: PoseFilterMode) => void;
}

const OPTIONS: { value: PoseFilterMode; label: string }[] = [
    { value: 'all',     label: 'All Poses' },
    { value: 'frontal', label: 'Frontal (≤30°)' },
    { value: 'profile', label: 'Profile (>45°)' },
];

export function PoseFilterToggle({ mode, onModeChange }: PoseFilterToggleProps) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 whitespace-nowrap">Pose:</span>
            <div className="flex rounded-md border border-gray-700 overflow-hidden text-xs">
                {OPTIONS.map(opt => (
                    <button
                        key={opt.value}
                        onClick={() => onModeChange(opt.value)}
                        className={`px-2 py-1 transition-colors whitespace-nowrap ${
                            mode === opt.value
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                        }`}
                        title={opt.label}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
