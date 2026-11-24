import SettingsSection from '../components/settings/SettingsSection';
import PreviewManager from '../components/settings/PreviewManager';
import LibraryStorageSection from '../components/settings/LibraryStorageSection';
import AiPerformanceSection from '../components/settings/AiPerformanceSection';
import PersonIdentificationSection from '../components/settings/PersonIdentificationSection';
import EraGenerationSection from '../components/settings/EraGenerationSection';
import DatabaseManagementSection from '../components/settings/DatabaseManagementSection';
import IntegrationsSection from '../components/settings/IntegrationsSection';
import HealthLogsSection from '../components/settings/HealthLogsSection';
import { useAiSettings } from '../hooks/useAiSettings';

export default function Settings() {
    const ai = useAiSettings();

    return (
        <div className="p-8 h-full overflow-y-auto bg-gray-900 text-gray-100 relative">
            <h2 className="text-3xl font-bold mb-8 text-white flex items-center justify-between">
                <span>Settings</span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl w-full">
                {/* Left Column */}
                <div className="space-y-8">
                    <LibraryStorageSection />

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
                </div>

                {/* Right Column */}
                <div className="space-y-8">
                    <SettingsSection title="Preview Cache">
                        <PreviewManager />
                    </SettingsSection>

                    <DatabaseManagementSection />
                </div>
            </div>

            <IntegrationsSection />

            <HealthLogsSection />
        </div>
    )
}
