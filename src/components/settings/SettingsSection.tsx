import type { ReactNode } from 'react'

interface SettingsSectionProps {
    title: string
    children: ReactNode
    /** Classes for the <section> element; the page spacing differs between the column and full-width sections. */
    className?: string
}

/** A titled settings section: the heading style shared by every block on the Settings screen. */
export default function SettingsSection({ title, children, className = 'space-y-4' }: SettingsSectionProps) {
    return (
        <section className={className}>
            <h3 className="text-xl font-semibold text-indigo-400 border-b border-gray-700 pb-2">{title}</h3>
            {children}
        </section>
    )
}
