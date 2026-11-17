import { useState, useEffect } from 'react'
import { useAlert } from '../context/AlertContext'

export type AiProfile = 'balanced' | 'high'

export interface EraConfig {
    minFaces: number
    mergeThreshold: number
}

/** Writes one change on top of the settings currently stored in the main process. */
async function saveMergedAiSettings(patch: Record<string, unknown>) {
    // @ts-ignore
    const current = await window.ipcRenderer.invoke('ai:getSettings');
    // @ts-ignore
    await window.ipcRenderer.invoke('ai:saveSettings', { ...current, ...patch });
}

/**
 * AI settings shown on the Settings screen: model profile, Smart Tags (VLM) and era generation.
 * Loads them once and saves each change merged with whatever is already stored.
 */
export function useAiSettings() {
    const { showConfirm } = useAlert();
    const [aiProfile, setAiProfile] = useState<AiProfile>('balanced');
    const [vlmEnabled, setVlmEnabled] = useState(false);
    const [eraConfig, setEraConfig] = useState<EraConfig>({ minFaces: 50, mergeThreshold: 0.75 });

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('ai:getSettings').then((settings: any) => {
            if (settings) {
                if (settings.aiProfile) setAiProfile(settings.aiProfile);
                if (settings.vlmEnabled !== undefined) setVlmEnabled(settings.vlmEnabled);
                setEraConfig({
                    minFaces: settings.minFacesForEra ?? 50,
                    mergeThreshold: settings.eraMergeThreshold ?? 0.75
                });
            }
        });
    }, [])

    const changeProfile = async (newProfile: AiProfile) => {
        setAiProfile(newProfile);
        await saveMergedAiSettings({ aiProfile: newProfile });

        showConfirm({
            title: 'Reload Required',
            description: 'Changing the AI profile requires a reload to load the new models. Reload now?',
            confirmLabel: 'Reload Now',
            onConfirm: () => window.location.reload()
        });
    }

    const toggleVlm = async () => {
        const newState = !vlmEnabled;
        setVlmEnabled(newState);
        await saveMergedAiSettings({ vlmEnabled: newState });

        showConfirm({
            title: 'Reload Required',
            description: `You have ${newState ? 'Enabled' : 'Disabled'} Smart Tags. Please reload the application to apply this change.`,
            confirmLabel: 'Reload Now',
            onConfirm: () => window.location.reload()
        });
    }

    const changeEraMergeThreshold = async (value: number) => {
        setEraConfig(prev => ({ ...prev, mergeThreshold: value }));
        await saveMergedAiSettings({ eraMergeThreshold: value });
    }

    const changeEraMinFaces = async (value: number) => {
        setEraConfig(prev => ({ ...prev, minFaces: value }));
        await saveMergedAiSettings({ minFacesForEra: value });
    }

    return { aiProfile, vlmEnabled, eraConfig, changeProfile, toggleVlm, changeEraMergeThreshold, changeEraMinFaces }
}
