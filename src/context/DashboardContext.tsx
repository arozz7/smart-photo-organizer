import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface DashboardStats {
    totalPhotos: number;
    processed: number;
    pending: number;
    errorCount: number;
    namedPeople: number;
    totalFaces: number;
    unassignedFaces: number;
}

interface FunFact {
    text: string;
    type: string;
}

export interface WidgetConfig {
    id: string;
    enabled: boolean;
    size: '1x1' | '2x1' | '2x2';
}

export interface DashboardLayoutConfig {
    widgets: WidgetConfig[];
    preset: 'minimal' | 'balanced' | 'power';
    reduceMotion: boolean;
}

interface TimelineEntry {
    period: string;
    count: number;
}

interface ErrorByStage {
    stage: string;
    count: number;
}

interface LibraryHealth {
    healthScore: number;
    errorsByStage: ErrorByStage[];
    recentErrorCount: number;
    totalErrors: number;
}

interface DashboardContextType {
    memories: any[];
    stats: DashboardStats | null;
    topPeople: any[];
    recentScans: any[];
    funFact: FunFact | null;
    timeline: TimelineEntry[];
    libraryHealth: LibraryHealth | null;
    loading: boolean;
    hasNewMemories: boolean;
    refresh: () => Promise<void>;
    refreshFunFact: () => Promise<void>;
    loaded: boolean;
    layoutConfig: DashboardLayoutConfig;
    updateLayoutConfig: (config: DashboardLayoutConfig) => void;
    isWidgetEnabled: (id: string) => boolean;
}

const DEFAULT_STATS: DashboardStats = {
    totalPhotos: 0, processed: 0, pending: 0,
    errorCount: 0, namedPeople: 0, totalFaces: 0, unassignedFaces: 0,
};

const DEFAULT_LAYOUT: DashboardLayoutConfig = {
    widgets: [
        { id: 'scanEntertainment', enabled: true, size: '2x1' },
        { id: 'onThisDay', enabled: true, size: '2x1' },
        { id: 'libraryStats', enabled: true, size: '1x1' },
        { id: 'peopleSpotlight', enabled: true, size: '2x1' },
        { id: 'recentActivity', enabled: true, size: '1x1' },
        { id: 'funFacts', enabled: true, size: '1x1' },
        { id: 'timeline', enabled: true, size: '2x1' },
        { id: 'libraryHealth', enabled: false, size: '1x1' },
    ],
    preset: 'balanced',
    reduceMotion: false,
};

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
    const [memories, setMemories] = useState<any[]>([]);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [topPeople, setTopPeople] = useState<any[]>([]);
    const [recentScans, setRecentScans] = useState<any[]>([]);
    const [funFact, setFunFact] = useState<FunFact | null>(null);
    const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
    const [libraryHealth, setLibraryHealth] = useState<LibraryHealth | null>(null);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [layoutConfig, setLayoutConfig] = useState<DashboardLayoutConfig>(DEFAULT_LAYOUT);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [memoriesRes, statsRes, peopleRes, recentRes, factRes, layoutRes, timelineRes, healthRes] = await Promise.all([
                window.ipcRenderer.invoke('dashboard:getOnThisDayPhotos', 3),
                window.ipcRenderer.invoke('dashboard:getStats'),
                window.ipcRenderer.invoke('dashboard:getTopPeople', 10),
                window.ipcRenderer.invoke('dashboard:getRecentScans', 12),
                window.ipcRenderer.invoke('dashboard:getFunFact'),
                window.ipcRenderer.invoke('dashboard:getLayout'),
                window.ipcRenderer.invoke('dashboard:getPhotoTimeline'),
                window.ipcRenderer.invoke('dashboard:getLibraryHealth'),
            ]);

            if (memoriesRes.success) setMemories(memoriesRes.photos);
            if (statsRes.success) setStats(statsRes.stats);
            if (peopleRes.success) setTopPeople(peopleRes.people);
            if (recentRes.success) setRecentScans(recentRes.photos);
            if (factRes.success) setFunFact(factRes.fact);
            if (layoutRes.success && layoutRes.config) setLayoutConfig(layoutRes.config);
            if (timelineRes.success) setTimeline(timelineRes.data);
            if (healthRes.success) setLibraryHealth(healthRes.data);
        } catch (err) {
            console.error('Dashboard refresh failed:', err);
        } finally {
            setLoading(false);
            setLoaded(true);
        }
    }, []);

    const refreshFunFact = useCallback(async () => {
        try {
            const res = await window.ipcRenderer.invoke('dashboard:getFunFact');
            if (res.success) setFunFact(res.fact);
        } catch (err) {
            console.error('Fun fact refresh failed:', err);
        }
    }, []);

    const updateLayoutConfig = useCallback((config: DashboardLayoutConfig) => {
        setLayoutConfig(config);
    }, []);

    const isWidgetEnabled = useCallback((id: string) => {
        const widget = layoutConfig.widgets.find(w => w.id === id);
        return widget?.enabled ?? true;
    }, [layoutConfig]);

    return (
        <DashboardContext.Provider value={{
            memories,
            stats: stats ?? DEFAULT_STATS,
            topPeople,
            recentScans,
            funFact,
            timeline,
            libraryHealth,
            loading,
            loaded,
            hasNewMemories: memories.length > 0,
            refresh,
            refreshFunFact,
            layoutConfig,
            updateLayoutConfig,
            isWidgetEnabled,
        }}>
            {children}
        </DashboardContext.Provider>
    );
}

export function useDashboard() {
    const ctx = useContext(DashboardContext);
    if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
    return ctx;
}
