interface SettingsToggleProps {
    label: string
    description: string
    value: boolean
    onChange: (val: boolean) => void
}

export default function SettingsToggle({ label, description, value, onChange }: SettingsToggleProps) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <h4 className="font-medium text-white">{label}</h4>
                <p className="text-sm text-gray-400 max-w-sm">{description}</p>
            </div>
            <button
                onClick={() => onChange(!value)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${value ? 'bg-indigo-600' : 'bg-gray-700'}`}
            >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
        </div>
    );
}
