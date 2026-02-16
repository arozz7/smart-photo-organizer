import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftIcon } from '@radix-ui/react-icons'

interface TimelineEntry {
    period: string;
    count: number;
}

interface TimelineWidgetProps {
    data: TimelineEntry[];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function TimelineWidget({ data }: TimelineWidgetProps) {
    const navigate = useNavigate();
    const [drillYear, setDrillYear] = useState<number | null>(null);
    const [monthData, setMonthData] = useState<TimelineEntry[]>([]);
    const [loadingMonths, setLoadingMonths] = useState(false);

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-based

    const maxCount = data.length > 0 ? Math.max(...data.map(d => d.count)) : 1;
    const maxMonthCount = monthData.length > 0 ? Math.max(...monthData.map(d => d.count)) : 1;

    const handleYearClick = useCallback(async (year: number) => {
        setLoadingMonths(true);
        setDrillYear(year);
        try {
            const res = await window.ipcRenderer.invoke('dashboard:getMonthlyBreakdown', year);
            if (res.success) setMonthData(res.data);
        } catch (err) {
            console.error('Failed to load monthly breakdown:', err);
        } finally {
            setLoadingMonths(false);
        }
    }, []);

    const handleBack = useCallback(() => {
        setDrillYear(null);
        setMonthData([]);
    }, []);

    const handleBarClick = useCallback((year: number, month?: number) => {
        const params = new URLSearchParams();
        params.set('year', String(year));
        if (month !== undefined) params.set('month', String(month));
        navigate(`/search?${params.toString()}`);
    }, [navigate]);

    if (data.length === 0) {
        return (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Photo Timeline</h3>
                <p className="text-sm text-gray-400">No photos with dates found. Scan your library to see the timeline.</p>
            </div>
        );
    }

    // Monthly drill-down view
    if (drillYear !== null) {
        return (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <button
                        onClick={handleBack}
                        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                        title="Back to years"
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                    </button>
                    <h3 className="text-lg font-semibold text-white">{drillYear} Monthly Breakdown</h3>
                </div>

                {loadingMonths ? (
                    <p className="text-sm text-gray-400">Loading...</p>
                ) : (
                    <div className="space-y-1.5">
                        {MONTH_NAMES.map((name, i) => {
                            const monthNum = i + 1;
                            const entry = monthData.find(d => parseInt(d.period) === monthNum);
                            const count = entry?.count ?? 0;
                            const pct = maxMonthCount > 0 ? (count / maxMonthCount) * 100 : 0;
                            const isCurrent = drillYear === currentYear && monthNum === currentMonth;

                            return (
                                <button
                                    key={monthNum}
                                    onClick={() => count > 0 && handleBarClick(drillYear, monthNum)}
                                    disabled={count === 0}
                                    className="w-full flex items-center gap-3 group"
                                >
                                    <span className={`w-8 text-xs text-right flex-shrink-0 ${isCurrent ? 'text-indigo-400 font-bold' : 'text-gray-400'}`}>
                                        {name}
                                    </span>
                                    <div className="flex-1 h-5 bg-gray-700/50 rounded overflow-hidden">
                                        {count > 0 && (
                                            <div
                                                className={`h-full rounded transition-all ${isCurrent ? 'bg-indigo-500' : 'bg-cyan-600 group-hover:bg-cyan-500'}`}
                                                style={{ width: `${Math.max(pct, 2)}%` }}
                                            />
                                        )}
                                    </div>
                                    <span className={`w-12 text-xs text-right flex-shrink-0 ${count > 0 ? 'text-gray-300' : 'text-gray-600'}`}>
                                        {count > 0 ? count.toLocaleString() : '-'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // Year overview
    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Photo Timeline</h3>

            <div className="space-y-1.5">
                {data.map(({ period, count }) => {
                    const year = parseInt(period);
                    const pct = (count / maxCount) * 100;
                    const isCurrent = year === currentYear;

                    return (
                        <button
                            key={period}
                            onClick={() => handleYearClick(year)}
                            className="w-full flex items-center gap-3 group"
                        >
                            <span className={`w-10 text-xs text-right flex-shrink-0 ${isCurrent ? 'text-indigo-400 font-bold' : 'text-gray-400'}`}>
                                {period}
                            </span>
                            <div className="flex-1 h-5 bg-gray-700/50 rounded overflow-hidden">
                                <div
                                    className={`h-full rounded transition-all ${isCurrent ? 'bg-indigo-500' : 'bg-cyan-600 group-hover:bg-cyan-500'}`}
                                    style={{ width: `${Math.max(pct, 2)}%` }}
                                />
                            </div>
                            <span className="w-12 text-xs text-gray-300 text-right flex-shrink-0">
                                {count.toLocaleString()}
                            </span>
                        </button>
                    );
                })}
            </div>

            <p className="text-xs text-gray-500 mt-3">Click a year to see monthly breakdown</p>
        </div>
    );
}
