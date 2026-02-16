import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'

interface WidgetConfig {
    id: string;
    enabled: boolean;
    size: '1x1' | '2x1' | '2x2';
}

interface DashboardLayoutConfig {
    widgets: WidgetConfig[];
    preset: 'minimal' | 'balanced' | 'power';
    reduceMotion: boolean;
}

interface WidgetCustomizationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (config: DashboardLayoutConfig) => void;
}

const WIDGET_LABELS: Record<string, { name: string; description: string }> = {
    scanEntertainment: { name: 'Scan Entertainment', description: 'Live progress and memory flashbacks during scans' },
    onThisDay: { name: 'On This Day', description: 'Photos from this day in previous years' },
    libraryStats: { name: 'Library Stats', description: 'Photo counts and processing status chart' },
    peopleSpotlight: { name: 'People Spotlight', description: 'Your most photographed people' },
    recentActivity: { name: 'Recent Activity', description: 'Latest scanned photos' },
    funFacts: { name: 'Fun Facts', description: 'Random insights about your library' },
    timeline: { name: 'Photo Timeline', description: 'Photo count by year with monthly drill-down' },
    libraryHealth: { name: 'Library Health', description: 'Processing status, error breakdown, and health score' },
    collage: { name: 'Photo Collage', description: 'Auto-generated photo collage with layout modes and export' },
};

const PRESETS: Record<string, string[]> = {
    minimal: ['libraryStats', 'peopleSpotlight'],
    balanced: ['scanEntertainment', 'onThisDay', 'libraryStats', 'peopleSpotlight', 'recentActivity', 'funFacts', 'timeline'],
    power: ['scanEntertainment', 'onThisDay', 'libraryStats', 'peopleSpotlight', 'recentActivity', 'funFacts', 'timeline', 'libraryHealth', 'collage'],
};

export default function WidgetCustomizationModal({ open, onOpenChange, onSave }: WidgetCustomizationModalProps) {
    const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
    const [preset, setPreset] = useState<'minimal' | 'balanced' | 'power'>('balanced');
    const [reduceMotion, setReduceMotion] = useState(false);
    const [saving, setSaving] = useState(false);

    // Load config when modal opens
    useEffect(() => {
        if (!open) return;
        window.ipcRenderer.invoke('dashboard:getLayout').then((res: any) => {
            if (res.success && res.config) {
                setWidgets(res.config.widgets || []);
                setPreset(res.config.preset || 'balanced');
                setReduceMotion(res.config.reduceMotion || false);
            }
        });
    }, [open]);

    const toggleWidget = (id: string) => {
        setWidgets(prev => prev.map(w => w.id === id ? { ...w, enabled: !w.enabled } : w));
    };

    const applyPreset = (name: 'minimal' | 'balanced' | 'power') => {
        setPreset(name);
        const enabledIds = PRESETS[name];
        setWidgets(prev => prev.map(w => ({ ...w, enabled: enabledIds.includes(w.id) })));
    };

    const handleSave = async () => {
        setSaving(true);
        const config: DashboardLayoutConfig = { widgets, preset, reduceMotion };
        await window.ipcRenderer.invoke('dashboard:saveLayout', config);
        onSave(config);
        setSaving(false);
        onOpenChange(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[80vh] bg-gray-900 border border-gray-700 p-6 rounded-lg shadow-xl z-50 flex flex-col animate-scale-in">
                    <Dialog.Title className="text-xl font-bold text-white mb-1">Customize Dashboard</Dialog.Title>
                    <Dialog.Description className="text-sm text-gray-400 mb-5">
                        Choose which widgets to display on your Home page.
                    </Dialog.Description>

                    {/* Presets */}
                    <div className="mb-5">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 block">Presets</label>
                        <div className="flex gap-2">
                            {(['minimal', 'balanced', 'power'] as const).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => applyPreset(p)}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                        preset === p
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                    }`}
                                >
                                    {p.charAt(0).toUpperCase() + p.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Widget toggles */}
                    <div className="flex-1 overflow-y-auto space-y-2 mb-5">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 block">Widgets</label>
                        {widgets.map((widget) => {
                            const meta = WIDGET_LABELS[widget.id];
                            if (!meta) return null;
                            return (
                                <div
                                    key={widget.id}
                                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                                        widget.enabled
                                            ? 'bg-gray-800 border-gray-600'
                                            : 'bg-gray-800/50 border-gray-800'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0 mr-3">
                                        <div className={`text-sm font-medium ${widget.enabled ? 'text-white' : 'text-gray-500'}`}>
                                            {meta.name}
                                        </div>
                                        <div className="text-xs text-gray-500 truncate">{meta.description}</div>
                                    </div>
                                    <button
                                        onClick={() => toggleWidget(widget.id)}
                                        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                                            widget.enabled ? 'bg-indigo-600' : 'bg-gray-700'
                                        }`}
                                    >
                                        <div
                                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                                widget.enabled ? 'translate-x-5' : 'translate-x-0.5'
                                            }`}
                                        />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* Reduce motion */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-800 border border-gray-700 mb-5">
                        <div>
                            <div className="text-sm font-medium text-white">Reduce Motion</div>
                            <div className="text-xs text-gray-500">Disable animations for lower-end hardware</div>
                        </div>
                        <button
                            onClick={() => setReduceMotion(!reduceMotion)}
                            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                                reduceMotion ? 'bg-indigo-600' : 'bg-gray-700'
                            }`}
                        >
                            <div
                                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                    reduceMotion ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3">
                        <Dialog.Close asChild>
                            <button className="px-4 py-2 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">
                                Cancel
                            </button>
                        </Dialog.Close>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>

                    <Dialog.Close asChild>
                        <button className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors" aria-label="Close">
                            <Cross2Icon className="w-4 h-4" />
                        </button>
                    </Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
