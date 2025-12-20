import { Outlet, NavLink } from 'react-router-dom'
import StatusBar from './StatusBar'
import { AIStatusIndicator } from './AIStatusIndicator'

export default function Layout() {
    return (
        <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
                <div className="p-4 border-b border-gray-700">
                    <h1 className="text-xl font-bold tracking-tight text-white">Smart Photo Organizer</h1>
                </div>

                <nav className="flex-1 p-2 space-y-1">
                    <NavLink
                        to="/"
                        className={({ isActive }) =>
                            `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }`
                        }
                    >
                        Library
                    </NavLink>
                    <NavLink
                        to="/create"
                        className={({ isActive }) =>
                            `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }`
                        }
                    >
                        Create
                    </NavLink>
                    <NavLink
                        to="/people"
                        className={({ isActive }) =>
                            `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }`
                        }
                    >
                        People
                    </NavLink>
                    <NavLink
                        to="/locations"
                        className={({ isActive }) =>
                            `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }`
                        }
                    >
                        Locations
                    </NavLink>
                    <NavLink
                        to="/queues"
                        className={({ isActive }) =>
                            `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }`
                        }
                    >
                        Queues
                    </NavLink>
                    <NavLink
                        to="/settings"
                        className={({ isActive }) =>
                            `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }`
                        }
                    >
                        Settings
                    </NavLink>
                </nav>

                <div className="p-4 border-t border-gray-700 space-y-2">
                    <AIStatusIndicator />
                    <div className="text-xs text-gray-500">v0.2.0</div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative flex flex-col">
                <div className="flex-1 overflow-hidden relative">
                    <Outlet />
                </div>
                <StatusBar />
            </main>
        </div>
    )
}
