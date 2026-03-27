import { useState, useEffect, useCallback, useRef } from 'react'
import { UpdateIcon, MixerHorizontalIcon } from '@radix-ui/react-icons'
import DuplicateGroupCard from '../components/DuplicateGroupCard'

type TabStatus = 'pending' | 'resolved' | 'dismissed'

interface Stats {
    pending_exact: number
    pending_near: number
    resolved: number
    dismissed: number
}

interface HashBackfillStats {
    needsSha256: number
    needsPhash: number
}

interface DuplicateGroup {
    id: number
    type: 'exact' | 'near'
    status: TabStatus
    winner_photo_id: number | null
    photos: any[]
}

const PAGE_SIZE = 20

export default function Duplicates() {
    const [tab, setTab] = useState<TabStatus>('pending')
    const [groups, setGroups] = useState<DuplicateGroup[]>([])
    const [stats, setStats] = useState<Stats>({ pending_exact: 0, pending_near: 0, resolved: 0, dismissed: 0 })
    const [loading, setLoading] = useState(true)
    const [triggering, setTriggering] = useState(false)
    const [offset, setOffset] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [backfill, setBackfill] = useState<HashBackfillStats>({ needsSha256: 0, needsPhash: 0 })
    const backfillPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const loadStats = useCallback(async () => {
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getDuplicateStats')
            if (res.success) setStats(res.stats)
        } catch (e) {
            console.error('[Duplicates] loadStats failed:', e)
        }
    }, [])

    const loadBackfillStats = useCallback(async () => {
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getHashBackfillStats')
            if (res.success) setBackfill({ needsSha256: res.needsSha256, needsPhash: res.needsPhash })
        } catch (e) {
            console.error('[Duplicates] loadBackfillStats failed:', e)
        }
    }, [])

    const loadGroups = useCallback(async (status: TabStatus, newOffset = 0, append = false) => {
        setLoading(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getDuplicateGroups', {
                status,
                limit: PAGE_SIZE,
                offset: newOffset,
            })
            if (res.success) {
                setGroups(prev => append ? [...prev, ...res.groups] : res.groups)
                setHasMore(res.groups.length === PAGE_SIZE)
                setOffset(newOffset + res.groups.length)
            }
        } catch (e) {
            console.error('[Duplicates] loadGroups failed:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        setOffset(0)
        loadGroups(tab, 0, false)
        loadStats()
        loadBackfillStats()

        // Poll backfill progress every 5 s while hashing is in progress
        backfillPollRef.current = setInterval(() => {
            loadBackfillStats()
        }, 5000)

        return () => {
            if (backfillPollRef.current) clearInterval(backfillPollRef.current)
        }
    }, [tab, loadGroups, loadStats, loadBackfillStats])

    const handleGroupResolved = useCallback(() => {
        // Reload the current page from scratch after any resolution
        loadGroups(tab, 0, false)
        loadStats()
    }, [tab, loadGroups, loadStats])

    const handleTriggerCheck = async () => {
        setTriggering(true)
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:triggerDuplicateCheck')
        } catch (e) {
            console.error('[Duplicates] triggerDuplicateCheck failed:', e)
        } finally {
            setTimeout(() => setTriggering(false), 1500)
        }
    }

    const pendingTotal = stats.pending_exact + stats.pending_near

    const tabs: { key: TabStatus; label: string; count: number }[] = [
        { key: 'pending', label: 'Pending', count: pendingTotal },
        { key: 'resolved', label: 'Resolved', count: stats.resolved },
        { key: 'dismissed', label: 'Dismissed', count: stats.dismissed },
    ]

    return (
        <div className="h-full flex flex-col bg-gray-900 text-gray-100 overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-700 flex-shrink-0">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Duplicate Photos</h1>
                        <p className="mt-1 text-sm text-gray-400">
                            Review groups of exact and visually similar photos. Keep the best copy and trash the rest.
                        </p>
                    </div>
                    <button
                        onClick={handleTriggerCheck}
                        disabled={triggering}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors disabled:opacity-50"
                        title="Re-run duplicate detection now"
                    >
                        <UpdateIcon className={`w-4 h-4 ${triggering ? 'animate-spin' : ''}`} />
                        {triggering ? 'Queued…' : 'Check now'}
                    </button>
                </div>

                {/* Stats pills */}
                <div className="flex gap-3 mt-4">
                    <StatPill label="Exact matches" value={stats.pending_exact} color="red" />
                    <StatPill label="Similar" value={stats.pending_near} color="yellow" />
                    <StatPill label="Resolved" value={stats.resolved} color="green" />
                </div>
            </div>

            {/* Hash backfill progress banner */}
            {(backfill.needsSha256 > 0 || backfill.needsPhash > 0) && (
                <HashingBanner needsSha256={backfill.needsSha256} needsPhash={backfill.needsPhash} />
            )}

            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-gray-700 flex-shrink-0">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            tab === t.key
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        {t.label}
                        {t.count > 0 && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${
                                tab === t.key ? 'bg-indigo-900 text-indigo-300' : 'bg-gray-700 text-gray-400'
                            }`}>
                                {t.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {loading && groups.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-gray-500">
                        <UpdateIcon className="w-5 h-5 animate-spin mr-2" />
                        Loading…
                    </div>
                ) : groups.length === 0 ? (
                    <EmptyState tab={tab} onTrigger={handleTriggerCheck} />
                ) : (
                    <>
                        {groups.map(group => (
                            <DuplicateGroupCard
                                key={group.id}
                                group={group}
                                onResolved={handleGroupResolved}
                            />
                        ))}

                        {hasMore && (
                            <div className="flex justify-center pt-2 pb-4">
                                <button
                                    onClick={() => loadGroups(tab, offset, true)}
                                    disabled={loading}
                                    className="px-4 py-2 rounded-md text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50"
                                >
                                    {loading ? 'Loading…' : 'Load more'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

function StatPill({ label, value, color }: { label: string; value: number; color: 'red' | 'yellow' | 'green' }) {
    const colors = {
        red: 'bg-red-900/40 text-red-300 border-red-800',
        yellow: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
        green: 'bg-green-900/40 text-green-300 border-green-800',
    }
    return (
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs ${colors[color]}`}>
            <span className="font-semibold tabular-nums">{value}</span>
            <span className="text-opacity-80">{label}</span>
        </div>
    )
}

function HashingBanner({ needsSha256, needsPhash }: { needsSha256: number; needsPhash: number }) {
    const sha256Active = needsSha256 > 0
    const phashActive  = needsPhash > 0

    const lines: string[] = []
    if (sha256Active) lines.push(`${needsSha256.toLocaleString()} photo${needsSha256 !== 1 ? 's' : ''} need SHA-256`)
    if (phashActive)  lines.push(`${needsPhash.toLocaleString()} photo${needsPhash !== 1 ? 's' : ''} need pHash`)

    return (
        <div className="mx-6 mt-3 flex items-center gap-3 px-4 py-3 rounded-lg bg-indigo-950/60 border border-indigo-800 text-sm">
            <UpdateIcon className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <span className="text-indigo-300 font-medium">Hashing library in background — </span>
                <span className="text-indigo-400">{lines.join(' · ')}</span>
            </div>
            <span className="text-xs text-indigo-500 flex-shrink-0">Duplicates appear after hashing completes</span>
        </div>
    )
}

function EmptyState({ tab, onTrigger }: { tab: TabStatus; onTrigger: () => void }) {
    if (tab === 'pending') {
        return (
            <div className="flex flex-col items-center justify-center h-60 text-center gap-4">
                <MixerHorizontalIcon className="w-12 h-12 text-gray-600" />
                <div>
                    <p className="text-gray-300 font-medium">No duplicates found yet</p>
                    <p className="text-gray-500 text-sm mt-1">
                        The background checker runs automatically after each scan.<br />
                        You can also trigger it manually.
                    </p>
                </div>
                <button
                    onClick={onTrigger}
                    className="px-4 py-2 rounded-md text-sm bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                    Run check now
                </button>
            </div>
        )
    }

    const messages: Record<TabStatus, string> = {
        pending: '',
        resolved: 'No resolved groups yet.',
        dismissed: 'No dismissed groups.',
    }

    return (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
            {messages[tab]}
        </div>
    )
}
