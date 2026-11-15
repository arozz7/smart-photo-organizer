import { useSendTo } from '../hooks/useSendTo';
import type { SendSource } from '../types/sendTo';

interface SendToButtonProps {
    source: SendSource;
    disabled?: boolean;
    /** A short link-style button for tight places such as a list row. */
    compact?: boolean;
    className?: string;
}

/** One "Send to <program>" button per available target. Sends file paths only; no photo is copied. */
export default function SendToButton({ source, disabled = false, compact = false, className }: SendToButtonProps) {
    const { targets, sending, send } = useSendTo();
    const style = className ?? (compact
        ? 'text-xs text-indigo-300 hover:text-indigo-200 ml-2 shrink-0 disabled:opacity-50'
        : 'bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm transition-colors disabled:opacity-50');

    return (
        <>
            {targets.map(target => (
                <button
                    key={target.id}
                    onClick={() => send(target, source)}
                    disabled={disabled || sending}
                    title={`Open these photos in ${target.label} (nothing is copied)`}
                    className={style}
                >
                    Send to {target.label}
                </button>
            ))}
        </>
    );
}
