import { useState } from 'react'
import { useAlert } from '../../context/AlertContext';
import SettingsSection from './SettingsSection';

/** Smart Assignment (Phase 105-4): run contextual label propagation for the whole library. */
export default function SmartAssignmentSection() {
    const { showAlert } = useAlert();
    const [propagating, setPropagating] = useState(false)
    const [propagateResult, setPropagateResult] = useState<{ propagated: number; skipped: number } | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const handleBatchPropagate = async () => {
        setPropagating(true);
        setPropagateResult(null);
        setNotice(null);
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:batchPropagateLabels');
            if (res.success && res.disabled) {
                setNotice(res.message ?? 'Nothing was assigned.');
            } else if (res.success) {
                setPropagateResult({ propagated: res.propagated, skipped: res.skipped });
            } else {
                showAlert({ title: 'Propagation Failed', description: res.error, variant: 'danger' });
            }
        } finally {
            setPropagating(false);
        }
    };

    return (
        <SettingsSection title="Smart Assignment">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
                <div>
                    <h4 className="font-medium text-white mb-1">Contextual Label Propagation</h4>
                    <p className="text-sm text-gray-400 mb-3">
                        Assigning hard-pose or blurry faces from nearby photos without review is switched off:
                        it assigned nothing on real libraries and could name the wrong person in group photos.
                        It is being redesigned as a list of suggestions you review before anything is assigned
                        (docs/plans/contextual-suggestions-plan.md).
                    </p>
                    <div className="flex items-center gap-4 flex-wrap">
                        <button
                            onClick={handleBatchPropagate}
                            disabled={propagating}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${propagating
                                ? 'bg-gray-600 cursor-not-allowed opacity-50 text-white'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                        >
                            {propagating ? 'Propagating…' : 'Run for Entire Library'}
                        </button>
                        {notice && (
                            <span className="text-sm text-amber-400">{notice}</span>
                        )}
                        {propagateResult && (
                            <span className="text-sm text-green-400">
                                Done — {propagateResult.propagated} face{propagateResult.propagated !== 1 ? 's' : ''} assigned
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </SettingsSection>
    )
}
