import { useState, useEffect, useCallback, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useRepairJob } from '../hooks/useRepairJob'
import type { RepairState, PrsAvailability, PrsJobResult } from '../types/prs'

interface ScanError {
    id: number
    photo_id: number | null
    file_path: string
    error_message: string
    stage: string
    timestamp: string
    is_unrepairable?: number
}

interface ScanWarningsModalProps {
    isOpen: boolean
    onClose: () => void
}

// ── Per-row repair progress indicator ────────────────────────────────────────

interface RepairProgressProps {
    state: RepairState
    onRetry: () => void
}

function RepairProgress({ state, onRetry }: RepairProgressProps) {
    const statusLabels: Record<string, string> = {
        checking_prs: 'Checking PRS...',
        analyzing: 'Analyzing...',
        repairing: 'Repairing...',
        verifying: 'Verifying...',
        done: 'Repaired ✓',
        failed: state.error ?? 'Failed',
        unrepairable: 'Unrepairable',
        prs_unavailable: 'PRS not running',
    }

    if (state.status === 'idle') return null

    if (state.status === 'unrepairable') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-orange-400 bg-orange-900/30 border border-orange-700/40 rounded px-2 py-0.5">
                🚫 Unrepairable
            </span>
        )
    }

    if (state.status === 'prs_unavailable') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
                PRS not running
            </span>
        )
    }

    if (state.status === 'failed') {
        return (
            <div className="flex items-center gap-2">
                <span className="text-xs text-red-400 max-w-[140px] truncate" title={state.error}>
                    {state.error ?? 'Failed'}
                </span>
                <button
                    onClick={onRetry}
                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                    Retry
                </button>
            </div>
        )
    }

    const isTerminal = state.status === 'done'
    const label = statusLabels[state.status] ?? state.stage ?? state.status

    return (
        <div className="flex flex-col gap-1 min-w-[140px]">
            <div className="flex justify-between text-[11px] text-gray-400">
                <span>{label}</span>
                {state.percent != null && state.percent > 0 && (
                    <span>{state.percent}%</span>
                )}
            </div>
            {!isTerminal && (
                <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: `${state.percent ?? 0}%` }}
                    />
                </div>
            )}
        </div>
    )
}

// ── Row-level repair hook wiring ──────────────────────────────────────────────

interface RepairRowActionsProps {
    err: ScanError
    repairState: RepairState
    prsAvailable: boolean
    onRepairClick: (err: ScanError) => void
    onRetry: (err: ScanError) => void
    onDelete: (id: number, deleteFile: boolean) => void
    onOpenFile: (path: string) => void
    deleting: number | null
    activeRepairJobId: string | null
    onJobDone: (result: PrsJobResult) => void
    onJobError: (msg: string) => void
}

function RepairRowActions({
    err,
    repairState,
    prsAvailable,
    onRepairClick,
    onRetry,
    onDelete,
    onOpenFile,
    deleting,
    activeRepairJobId,
    onJobDone,
    onJobError,
}: RepairRowActionsProps) {
    // Wire polling only while a PRS repair job is in progress
    useRepairJob(activeRepairJobId, onJobDone, onJobError)

    const isActive = repairState.status !== 'idle'
    const isUnrepairable = repairState.status === 'unrepairable' || Boolean(err.is_unrepairable)

    const repairDisabled =
        !prsAvailable ||
        Boolean(isUnrepairable) ||
        isActive

    const repairTooltip = !prsAvailable
        ? 'Photo Repair Shop is not running'
        : isUnrepairable
            ? 'This file could not be repaired'
            : 'Repair this file with Photo Repair Shop'

    return (
        <div className="flex justify-end items-center gap-2">
            {isActive ? (
                <RepairProgress state={repairState} onRetry={() => onRetry(err)} />
            ) : (
                <>
                    {isUnrepairable && (
                        <span className="text-xs text-orange-400 bg-orange-900/20 border border-orange-800/40 rounded px-1.5 py-0.5">
                            Unrepairable
                        </span>
                    )}
                    <button
                        onClick={() => onRepairClick(err)}
                        disabled={repairDisabled}
                        title={repairTooltip}
                        className="p-1.5 text-indigo-400 hover:bg-indigo-900/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        🔧
                    </button>
                </>
            )}
            <button
                onClick={() => onOpenFile(err.file_path)}
                className="p-1.5 text-blue-400 hover:bg-blue-900/20 rounded"
                title="Show in Folder"
            >
                📂
            </button>
            <button
                onClick={() => onDelete(err.id, false)}
                disabled={deleting === err.id || isActive}
                className="p-1.5 text-gray-400 hover:bg-gray-800 rounded disabled:opacity-30"
                title="Dismiss Warning (Keep File)"
            >
                👁️‍🗨️
            </button>
            <button
                onClick={() => onDelete(err.id, true)}
                disabled={deleting === err.id || isActive}
                className="p-1.5 text-red-400 hover:bg-red-900/20 rounded disabled:opacity-30"
                title="Delete File Permanently"
            >
                🗑️
            </button>
        </div>
    )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function ScanWarningsModal({ isOpen, onClose }: ScanWarningsModalProps) {
    const [errors, setErrors] = useState<ScanError[]>([])
    const [loading, setLoading] = useState(false)
    const [deleting, setDeleting] = useState<number | null>(null)
    const [prsAvailability, setPrsAvailability] = useState<PrsAvailability>({ available: false })

    // Per-row state: Map<scanErrorId, RepairState>
    const [repairStates, setRepairStates] = useState<Map<number, RepairState>>(new Map())
    // Always-current ref so callbacks don't capture stale state
    const repairStatesRef = useRef(repairStates)
    repairStatesRef.current = repairStates
    // Per-row active PRS job id for polling: Map<scanErrorId, jobId | null>
    const [repairJobIds, setRepairJobIds] = useState<Map<number, string | null>>(new Map())

    const setRowState = useCallback((id: number, patch: Partial<RepairState>) => {
        setRepairStates(prev => {
            const next = new Map(prev)
            next.set(id, { ...((prev.get(id)) ?? { status: 'idle' }), ...patch })
            return next
        })
    }, [])

    const loadErrors = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getScanErrors')
            if (Array.isArray(res)) {
                setErrors(res)
            } else if (res?.success) {
                setErrors(res.errors)
            }
        } catch (e) {
            console.error('Failed to load scan errors', e)
        } finally {
            setLoading(false)
        }
    }

    const checkPrsAvailability = async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('prs:checkAvailability')
            setPrsAvailability(result ?? { available: false })
        } catch {
            setPrsAvailability({ available: false })
        }
    }

    useEffect(() => {
        if (isOpen) {
            loadErrors()
            checkPrsAvailability()
        }
    }, [isOpen])

    const handleDelete = async (id: number, deleteFile: boolean) => {
        if (!confirm(deleteFile ? 'Permanently delete this file?' : 'Dismiss this warning?')) return
        setDeleting(id)
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:deleteScanError', { id, deleteFile })
            setErrors(prev => prev.filter(e => e.id !== id))
        } catch (e) {
            console.error('Failed to delete', e)
            alert('Failed to action: ' + String(e))
        } finally {
            setDeleting(null)
        }
    }

    const openFile = async (path: string) => {
        // @ts-ignore
        await window.ipcRenderer.invoke('os:showInFolder', path)
    }

    const startRepair = async (err: ScanError) => {
        setRowState(err.id, { status: 'checking_prs' })

        // Re-check availability
        try {
            // @ts-ignore
            const avail = await window.ipcRenderer.invoke('prs:checkAvailability')
            if (!avail?.available) {
                setRowState(err.id, { status: 'prs_unavailable' })
                return
            }
        } catch {
            setRowState(err.id, { status: 'prs_unavailable' })
            return
        }

        // Step 1: Analyze
        setRowState(err.id, { status: 'analyzing' })
        let analyzeJobId: string
        try {
            // @ts-ignore
            const analyzeRes = await window.ipcRenderer.invoke('prs:analyzeFile', {
                filePath: err.file_path,
                photoId: err.photo_id ?? undefined,
            })
            if (analyzeRes?.error) throw new Error(analyzeRes.error)
            analyzeJobId = analyzeRes.jobId
        } catch (e) {
            setRowState(err.id, { status: 'failed', error: String(e) })
            return
        }

        // Poll analyze job to get suggested strategy
        let strategy: string | undefined
        try {
            const analyzeDeadline = Date.now() + 120_000
            while (Date.now() < analyzeDeadline) {
                await new Promise(r => setTimeout(r, 2_000))
                // @ts-ignore
                const statusRes = await window.ipcRenderer.invoke('prs:pollStatus', { jobId: analyzeJobId })
                if (statusRes?.status === 'done') {
                    strategy = statusRes?.result?.suggestedStrategies?.[0]?.strategy
                    break
                }
                if (statusRes?.status === 'failed') {
                    throw new Error(statusRes.error ?? 'Analysis failed')
                }
            }
            if (!strategy) throw new Error('No repair strategy suggested')
        } catch (e) {
            setRowState(err.id, { status: 'failed', error: String(e) })
            return
        }

        // Step 2: Submit repair
        setRowState(err.id, { status: 'repairing' })
        try {
            // @ts-ignore
            const repairRes = await window.ipcRenderer.invoke('prs:submitRepair', {
                filePath: err.file_path,
                strategy,
                sourcePhotoId: err.photo_id ?? undefined,
            })
            if (repairRes?.error) throw new Error(repairRes.error)

            // Store job id — useRepairJob hook in RepairRowActions will poll it
            setRepairJobIds(prev => {
                const next = new Map(prev)
                next.set(err.id, repairRes.jobId)
                return next
            })
            setRowState(err.id, {
                status: 'repairing',
                jobId: repairRes.jobId,
                percent: 0,
                repairedFilePath: repairRes.outputPath,
            })
        } catch (e) {
            setRowState(err.id, { status: 'failed', error: String(e) })
        }
    }

    const handleJobDone = useCallback(async (errId: number, err: ScanError, result: PrsJobResult) => {
        // Stop polling
        setRepairJobIds(prev => { const n = new Map(prev); n.set(errId, null); return n })

        // Prefer the path PRS returns in its status payload; fall back to the path
        // SPO derived and stored locally when the repair was submitted.
        const repairedFilePath =
            result.result?.outputPath ?? repairStatesRef.current.get(errId)?.repairedFilePath
        if (!repairedFilePath) {
            setRowState(errId, { status: 'failed', error: 'No output path in result' })
            return
        }

        // Step 3: Verify and commit
        setRowState(errId, { status: 'verifying', percent: 100 })
        try {
            // @ts-ignore
            const commitRes = await window.ipcRenderer.invoke('prs:completeRepair', {
                scanErrorId: errId,
                originalPhotoId: err.photo_id ?? undefined,
                repairedFilePath,
            })

            if (commitRes?.unrepairable) {
                setRowState(errId, { status: 'unrepairable', error: commitRes.reason })
            } else if (commitRes?.success) {
                setRowState(errId, { status: 'done' })
                // Remove row after short delay
                setTimeout(() => setErrors(prev => prev.filter(e => e.id !== errId)), 1_500)
            } else {
                setRowState(errId, { status: 'failed', error: commitRes?.error ?? 'Commit failed' })
            }
        } catch (e) {
            setRowState(errId, { status: 'failed', error: String(e) })
        }
    }, [setRowState])

    const handleJobError = useCallback((errId: number, msg: string) => {
        setRepairJobIds(prev => { const n = new Map(prev); n.set(errId, null); return n })
        setRowState(errId, { status: 'failed', error: msg })
    }, [setRowState])

    return (
        <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed inset-4 md:inset-20 bg-gray-900 rounded-xl border border-red-900/50 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in">

                    {/* Header */}
                    <div className="flex-none p-4 border-b border-gray-800 flex items-center justify-between text-white bg-gray-900/50 backdrop-blur">
                        <Dialog.Title className="text-xl font-semibold flex items-center gap-2">
                            <span className="text-red-500">⚠️</span>
                            Scan Warnings
                            <span className="text-sm font-normal text-gray-400 ml-2">
                                ({errors.length} issues)
                            </span>
                            {prsAvailability.available && (
                                <span className="text-xs text-indigo-400 bg-indigo-900/30 border border-indigo-700/40 rounded px-2 py-0.5 ml-2">
                                    🔧 PRS ready
                                </span>
                            )}
                        </Dialog.Title>
                        <button onClick={onClose} className="text-gray-400 hover:text-white">Close</button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-0">
                        {loading ? (
                            <div className="flex items-center justify-center h-full p-20">
                                <div className="animate-spin h-8 w-8 border-4 border-red-500 border-t-transparent rounded-full" />
                            </div>
                        ) : errors.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-20">
                                <span className="text-4xl mb-4">✅</span>
                                <p>No warnings found.</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-800/50 text-gray-400 font-medium border-b border-gray-800">
                                    <tr>
                                        <th className="p-3">File</th>
                                        <th className="p-3">Error</th>
                                        <th className="p-3">Stage</th>
                                        <th className="p-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {errors.map(err => (
                                        <tr key={err.id} className="hover:bg-gray-800/30 transition-colors group">
                                            <td className="p-3 max-w-[200px] truncate text-gray-300" title={err.file_path}>
                                                <div className="font-mono text-xs opacity-70 mb-1">{err.file_path.split(/[/\\]/).pop()}</div>
                                                <div className="text-[10px] text-gray-500 truncate">{err.file_path}</div>
                                            </td>
                                            <td className="p-3 text-red-300 break-words max-w-[300px]">
                                                {err.error_message}
                                            </td>
                                            <td className="p-3 text-gray-400 whitespace-nowrap">
                                                {err.stage}
                                                <div className="text-[10px] opacity-50">{new Date(err.timestamp).toLocaleString()}</div>
                                            </td>
                                            <td className="p-3 text-right whitespace-nowrap">
                                                <RepairRowActions
                                                    err={err}
                                                    repairState={repairStates.get(err.id) ?? { status: 'idle' }}
                                                    prsAvailable={prsAvailability.available}
                                                    onRepairClick={startRepair}
                                                    onRetry={startRepair}
                                                    onDelete={handleDelete}
                                                    onOpenFile={openFile}
                                                    deleting={deleting}
                                                    activeRepairJobId={repairJobIds.get(err.id) ?? null}
                                                    onJobDone={(result) => handleJobDone(err.id, err, result)}
                                                    onJobError={(msg) => handleJobError(err.id, msg)}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
