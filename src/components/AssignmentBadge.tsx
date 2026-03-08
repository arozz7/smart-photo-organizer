/**
 * AssignmentBadge
 *
 * Small overlay badge shown on face thumbnails to indicate how a face
 * was assigned to a person.  Only renders for non-manual sources.
 */

interface AssignmentBadgeProps {
    source: string | null | undefined;
}

const BADGE_CONFIG: Record<string, { label: string; title: string; className: string }> = {
    context_temporal: {
        label: 'T',
        title: 'Assigned by temporal context (same session / ±5 min)',
        className: 'bg-sky-600 text-white',
    },
    context_spatial: {
        label: 'G',
        title: 'Assigned by GPS context (≤100 m)',
        className: 'bg-emerald-600 text-white',
    },
};

export default function AssignmentBadge({ source }: AssignmentBadgeProps) {
    if (!source || source === 'manual') return null;

    const config = BADGE_CONFIG[source];
    if (!config) return null;

    return (
        <span
            title={config.title}
            className={`absolute bottom-1 left-1 z-10 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold leading-none select-none ${config.className}`}
        >
            {config.label}
        </span>
    );
}
