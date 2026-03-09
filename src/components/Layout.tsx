import { Outlet, NavLink } from 'react-router-dom'
import {
    HomeIcon, ImageIcon, PersonIcon, GlobeIcon,
    ListBulletIcon, GearIcon, PlusCircledIcon, MagnifyingGlassIcon,
    CopyIcon,
} from '@radix-ui/react-icons'
import { useState, useEffect } from 'react'
import StatusBar from './StatusBar'
import { AIStatusIndicator } from './AIStatusIndicator'
import { useScan } from '../context/ScanContext'
import { useDashboard } from '../context/DashboardContext'
import PhotoDetail from './PhotoDetail'

interface SidebarLinkProps {
    to: string
    icon: React.ReactNode
    children: React.ReactNode
    end?: boolean
    badge?: React.ReactNode
}

function SidebarLink({ to, icon, children, end, badge }: SidebarLinkProps) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
            }
        >
            <span aria-hidden="true">{icon}</span>
            {children}
            {badge}
        </NavLink>
    )
}

function useDuplicateCount() {
    const [count, setCount] = useState(0)
    useEffect(() => {
        let cancelled = false
        async function load() {
            try {
                // @ts-ignore
                const res = await window.ipcRenderer.invoke('db:getDuplicateStats')
                if (!cancelled && res.success) {
                    setCount((res.stats.pending_exact ?? 0) + (res.stats.pending_near ?? 0))
                }
            } catch { /* non-critical */ }
        }
        load()
        const id = setInterval(load, 60_000)
        return () => { cancelled = true; clearInterval(id) }
    }, [])
    return count
}

export default function Layout() {
    const { viewingPhoto, setViewingPhoto, navigateToPhoto } = useScan()
    const { hasNewMemories } = useDashboard()
    const duplicateCount = useDuplicateCount()
    return (
        <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
                <div className="p-4 border-b border-gray-700">
                    <h1 className="text-xl font-bold tracking-tight text-white">Smart Photo Organizer</h1>
                </div>

                <nav className="flex-1 p-2 space-y-1">
                    {/* Core */}
                    <SidebarLink
                        to="/"
                        end
                        icon={<HomeIcon className="w-4 h-4" />}
                        badge={hasNewMemories ? (
                            <span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0 ml-auto" title="New memories available" />
                        ) : null}
                    >
                        Home
                    </SidebarLink>
                    <SidebarLink to="/library" icon={<ImageIcon className="w-4 h-4" />}>Library</SidebarLink>
                    <SidebarLink to="/search" icon={<MagnifyingGlassIcon className="w-4 h-4" />}>Search</SidebarLink>
                    <SidebarLink to="/people" icon={<PersonIcon className="w-4 h-4" />}>People</SidebarLink>
                    <SidebarLink to="/locations" icon={<GlobeIcon className="w-4 h-4" />}>Locations</SidebarLink>

                    {/* Tools */}
                    <div className="pt-3 mt-3 border-t border-gray-700/50 space-y-1">
                        <SidebarLink to="/create" icon={<PlusCircledIcon className="w-4 h-4" />}>Create</SidebarLink>
                        <SidebarLink to="/queues" icon={<ListBulletIcon className="w-4 h-4" />}>Queues</SidebarLink>
                        <SidebarLink
                            to="/duplicates"
                            icon={<CopyIcon className="w-4 h-4" />}
                            badge={duplicateCount > 0 ? (
                                <span className="ml-auto px-1.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-600 text-white tabular-nums">
                                    {duplicateCount > 99 ? '99+' : duplicateCount}
                                </span>
                            ) : null}
                        >
                            Duplicates
                        </SidebarLink>
                    </div>

                    {/* System */}
                    <div className="pt-3 mt-3 border-t border-gray-700/50 space-y-1">
                        <SidebarLink to="/settings" icon={<GearIcon className="w-4 h-4" />}>Settings</SidebarLink>
                    </div>
                </nav>

                <div className="p-4 border-t border-gray-700 space-y-2">
                    <AIStatusIndicator />
                    <button
                        onClick={() => { /* TODO: open About/changelog dialog */ }}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                        title="View changelog"
                    >
                        v0.7.5
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative flex flex-col">
                <div className="flex-1 overflow-hidden relative">
                    <Outlet />
                </div>
                <StatusBar />

                {viewingPhoto && (
                    <PhotoDetail
                        photo={viewingPhoto}
                        onClose={() => setViewingPhoto(null)}
                        onNext={() => navigateToPhoto(1)}
                        onPrev={() => navigateToPhoto(-1)}
                    />
                )}
            </main>
        </div>
    )
}
