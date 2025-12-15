import Store from 'electron-store';
import { app } from 'electron';
import path from 'node:path';

interface StoreSchema {
    libraryPath: string;
    aiSettings: {
        faceDetectionThreshold: number;
        faceBlurThreshold: number;
        vlmTemperature: number;
        vlmMaxTokens: number;
    }
}

const store = new Store<StoreSchema>({
    defaults: {
        libraryPath: path.join(app.getPath('userData')),
        aiSettings: {
            faceDetectionThreshold: 0.6,
            faceBlurThreshold: 20.0,
            vlmTemperature: 0.2,
            vlmMaxTokens: 100
        }
    }
});

export function getLibraryPath(): string {
    return store.get('libraryPath');
}

export function setLibraryPath(newPath: string) {
    store.set('libraryPath', newPath);
}

export function getAISettings() {
    return store.get('aiSettings');
}

export function setAISettings(settings: StoreSchema['aiSettings']) {
    store.set('aiSettings', settings);
}

export default store;
