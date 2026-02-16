import { useEffect, useState } from 'react'
import { GearIcon } from '@radix-ui/react-icons'
import { useDashboard } from '../context/DashboardContext'
import WidgetGrid from '../components/dashboard/WidgetGrid'
import WidgetCustomizationModal from '../components/dashboard/WidgetCustomizationModal'
import type { DashboardLayoutConfig } from '../context/DashboardContext'

export default function Home() {
    const { loading, loaded, refresh, updateLayoutConfig } = useDashboard();
    const [customizeOpen, setCustomizeOpen] = useState(false);

    // Fetch dashboard data on mount (lazy load)
    useEffect(() => {
        if (!loaded) {
            refresh();
        }
    }, [loaded, refresh]);

    const today = new Date();
    const dateString = today.toLocaleDateString('default', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    const handleLayoutSave = (config: DashboardLayoutConfig) => {
        updateLayoutConfig(config);
    };

    return (
        <div className="flex flex-col h-full bg-gray-900">
            {/* Header */}
            <header className="h-14 border-b border-gray-700 flex items-center px-6 bg-gray-800/50 backdrop-blur shrink-0">
                <div>
                    <h2 className="text-lg font-semibold text-white">Home</h2>
                </div>
                <span className="ml-3 text-sm text-gray-400">{dateString}</span>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={() => setCustomizeOpen(true)}
                        className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                        title="Customize dashboard"
                    >
                        <GearIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={refresh}
                        disabled={loading}
                        className="text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
                {loading && !loaded ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-gray-500 text-sm">Loading dashboard...</div>
                    </div>
                ) : (
                    <WidgetGrid />
                )}
            </div>

            <WidgetCustomizationModal
                open={customizeOpen}
                onOpenChange={setCustomizeOpen}
                onSave={handleLayoutSave}
            />
        </div>
    );
}
