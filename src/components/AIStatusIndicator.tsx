import React from 'react';
import { useAI } from '../context/AIContext';
import { LightningBoltIcon, DesktopIcon, ExclamationTriangleIcon, UpdateIcon } from '@radix-ui/react-icons';
import * as Tooltip from '@radix-ui/react-tooltip';

export const AIStatusIndicator: React.FC = () => {
    const { aiMode, vlmEnabled } = useAI();

    // Loading State
    if (aiMode === 'UNKNOWN') {
        return (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium select-none text-slate-400 bg-slate-400/10 border-slate-400/20">
                <UpdateIcon className="w-3.5 h-3.5 animate-spin" />
                <span>Starting AI...</span>
            </div>
        );
    }

    let icon;
    let label;
    let colorClass;
    let tooltip;

    switch (aiMode) {
        case 'GPU':
            icon = <LightningBoltIcon className="w-3.5 h-3.5" />;
            label = "Enhanced (GPU)";
            colorClass = "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
            tooltip = "AI requires NVIDIA GPU. Maximum speed and features enabled.";
            break;
        case 'CPU':
            icon = <DesktopIcon className="w-3.5 h-3.5" />;
            label = "Enhanced (CPU)";
            colorClass = "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
            tooltip = "Running on CPU. Slower performance but full feature set.";
            break;
        case 'SAFE_MODE':
            icon = <ExclamationTriangleIcon className="w-3.5 h-3.5" />;
            label = "Safe Mode";
            colorClass = "text-orange-400 bg-orange-400/10 border-orange-400/20";
            tooltip = "Restricted Mode. Advanced features disabled due to compatibility issues.";
            break;
        default:
            return null;
    }

    return (
        <div className="flex flex-col gap-1">
            <Tooltip.Provider>
                <Tooltip.Root delayDuration={200}>
                    <Tooltip.Trigger asChild>
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium select-none cursor-help ${colorClass}`}>
                            {icon}
                            <span>{label}</span>
                        </div>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                        <Tooltip.Content className="z-50 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded border border-slate-700 shadow-xl" sideOffset={5}>
                            {tooltip}
                            <Tooltip.Arrow className="fill-slate-700" />
                        </Tooltip.Content>
                    </Tooltip.Portal>
                </Tooltip.Root>
            </Tooltip.Provider>

            {vlmEnabled === false && (
                <div className="px-2 text-[10px] text-gray-500 text-center scale-90 opacity-70">
                    Tagging Unavailable
                </div>
            )}
        </div>
    );
};
