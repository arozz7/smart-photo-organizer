import { useState } from 'react'
import SettingsSection from '../components/settings/SettingsSection';
import PreviewManager from '../components/settings/PreviewManager';
import LibraryStorageSection from '../components/settings/LibraryStorageSection';
import AiPerformanceSection from '../components/settings/AiPerformanceSection';
import PersonIdentificationSection from '../components/settings/PersonIdentificationSection';
import EraGenerationSection from '../components/settings/EraGenerationSection';
import SmartAssignmentSection from '../components/settings/SmartAssignmentSection';
import DatabaseManagementSection from '../components/settings/DatabaseManagementSection';
import IntegrationsSection from '../components/settings/IntegrationsSection';
import HealthLogsSection from '../components/settings/HealthLogsSection';
import { useAiSettings } from '../hooks/useAiSettings';

export default function Settings() {
    // Shared busy flag: set while Clear Tags runs and (existing behaviour) when a library move starts.
    const [clearing, setClearing] = useState(false)
    const ai = useAiSettings();

    return (
        <div className="p-8 h-full overflow-y-auto bg-gray-900 text-gray-100 relative">
            <h2 className="text-3xl font-bold mb-8 text-white flex items-center justify-between">
                <span>Settings</span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl w-full">
                {/* Left Column */}
                <div className="space-y-8">
                    <LibraryStorageSection onMoveStarted={() => setClearing(true)} />

                    <AiPerformanceSection
                        aiProfile={ai.aiProfile}
                        vlmEnabled={ai.vlmEnabled}
                        onProfileChange={ai.changeProfile}
                        onVlmToggle={ai.toggleVlm}
                    />

                    <PersonIdentificationSection />

                    <EraGenerationSection
                        eraConfig={ai.eraConfig}
                        onMergeThresholdChange={ai.changeEraMergeThreshold}
                        onMinFacesChange={ai.changeEraMinFaces}
                    />

                    <SmartAssignmentSection />
                </div>

                {/* Right Column */}
                <div className="space-y-8">
                    <SettingsSection title="Preview Cache">
                        <PreviewManager />
                    </SettingsSection>

                    <DatabaseManagementSection clearing={clearing} onClearingChange={setClearing} />
                </div>
            </div>

            <IntegrationsSection />

            <HealthLogsSection />
        </div>
    )
}
