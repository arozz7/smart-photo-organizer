import { ConfigService, AISettings } from './core/services/ConfigService';

// Re-export Schema for compatibility if needed
export type StoreSchema = {
    aiSettings: AISettings;
    libraryPath: string;
    windowBounds: any;
}

export function getAISettings() {
    return ConfigService.getAISettings();
}

export function setAISettings(settings: any) {
    ConfigService.setAISettings(settings);
}

export function getLibraryPath() {
    return ConfigService.getLibraryPath();
}

export function setLibraryPath(path: string) {
    ConfigService.setLibraryPath(path);
}

export function getWindowBounds() {
    return ConfigService.getSettings().windowBounds;
}

export function setWindowBounds(bounds: any) {
    ConfigService.updateSettings({ windowBounds: bounds });
}

// FAISS Stale Count Tracking
// Tracks faces removed/ignored that were in the FAISS index
// When count > 0, UI should suggest rebuild
export function getFaissStaleCount(): number {
    return ConfigService.getSettings().faissStaleCount || 0;
}

export function incrementFaissStaleCount(amount: number = 1): void {
    const current = getFaissStaleCount();
    ConfigService.updateSettings({ faissStaleCount: current + amount });
}

export function resetFaissStaleCount(): void {
    ConfigService.updateSettings({ faissStaleCount: 0 });
}

// Legacy accessor used in some places?
export const store = {
    get: (key: string, def?: any) => {
        const s = ConfigService.getSettings() as any;
        // Basic dot support
        if (key.includes('.')) {
            const parts = key.split('.');
            let val = s;
            for (const p of parts) val = val ? val[p] : undefined;
            return val !== undefined ? val : def;
        }
        return s[key] !== undefined ? s[key] : def;
    },
    set: (key: string, val: any) => {
        // Basic dot support for 'queue.batchSize'
        if (key === 'queue.batchSize') {
            ConfigService.updateQueueConfig({ batchSize: val });
        } else if (key === 'queue.cooldownSeconds') {
            ConfigService.updateQueueConfig({ cooldownSeconds: val });
        } else if (key === 'ai_queue') {
            ConfigService.updateSettings({ ai_queue: val });
        } else {
            // Generic fallback
            ConfigService.updateSettings({ [key]: val });
        }
    }
};
