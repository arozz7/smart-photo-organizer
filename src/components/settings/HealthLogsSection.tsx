import { useState } from 'react'
import ScanWarningsModal from '../ScanWarningsModal';
import SettingsSection from './SettingsSection';

/** Health & Logs: opens the list of corrupt files and errors found while scanning. */
export default function HealthLogsSection() {
    const [showWarningsModal, setShowWarningsModal] = useState(false);

    return (
        <>
            <ScanWarningsModal
                isOpen={showWarningsModal}
                onClose={() => setShowWarningsModal(false)}
            />

            {/* Scan Errors / Warnings */}
            <SettingsSection title="Health & Logs" className="space-y-4 pt-8">
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 flex justify-between items-center">
                    <div>
                        <h4 className="font-medium text-white">Scan Warnings</h4>
                        <p className="text-sm text-gray-400 mt-1">
                            View corrupt files or errors encountered during scanning.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowWarningsModal(true)}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                    >
                        View Warnings
                    </button>
                </div>
            </SettingsSection>
        </>
    )
}
