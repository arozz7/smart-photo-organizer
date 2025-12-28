import Store from 'electron-store';
import { app } from 'electron';
import path from 'node:path';

interface StoreSchema {
    libraryPath: string;
    aiSettings: {
        faceDetectionThreshold: number;
        faceSimilarityThreshold: number;
        faceBlurThreshold: number;
        vlmTemperature: number;
        vlmMaxTokens: number;
        hideUnnamedFacesByDefault: boolean;
    }
    windowBounds: {
        width: number;
        height: number;
        x?: number;
        y?: number;
    }
}

const store = new Store<StoreSchema>({
    defaults: {
        libraryPath: path.join(app.getPath('userData')),
        aiSettings: {
            faceDetectionThreshold: 0.6,
            faceSimilarityThreshold: 0.65, // Add new setting
            faceBlurThreshold: 20.0,
            vlmTemperature: 0.2,
            vlmMaxTokens: 100,
            hideUnnamedFacesByDefault: true
        },
        windowBounds: {
            width: 1200,
            height: 800,
            x: undefined,
            y: undefined
        }
    }
});

export function getWindowBounds() {
    return store.get('windowBounds');
}

export function setWindowBounds(bounds: any) {
    store.set('windowBounds', bounds);
}

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
