import { app } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs';

// Define Schema Interfaces
export interface AISettings {
    faceSimilarityThreshold: number;
    faceBlurThreshold: number;
    minFaceSize: number;
    modelSize: 'small' | 'medium' | 'large';
    aiProfile: 'fast' | 'balanced' | 'high';
    useGpu: boolean;
    vlmEnabled: boolean;
}

export interface WindowBounds {
    width: number;
    height: number;
    x: number;
    y: number;
}

export interface QueueConfig {
    batchSize: number;
    cooldownSeconds: number;
}

export interface AppConfig {
    libraryPath: string;
    aiSettings: AISettings;
    windowBounds: WindowBounds;
    firstRun: boolean;
    queue: QueueConfig;
    ai_queue: any[]; // Queue items
}

// Default Config
const DEFAULT_CONFIG: AppConfig = {
    libraryPath: '',
    aiSettings: {
        faceSimilarityThreshold: 0.65,
        faceBlurThreshold: 20,
        minFaceSize: 40,
        modelSize: 'medium',
        aiProfile: 'balanced',
        useGpu: true,
        vlmEnabled: false // Default to off for performance
    },
    windowBounds: { width: 1200, height: 800, x: 0, y: 0 },
    firstRun: true,
    queue: { batchSize: 0, cooldownSeconds: 60 },
    ai_queue: []
};

export class ConfigService {
    private static configPath = path.join(app.getPath('userData'), 'config.json');
    private static config: AppConfig;

    private static load() {
        if (this.config) return;
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf8');
                const parsed = JSON.parse(raw);
                this.config = { ...DEFAULT_CONFIG, ...parsed };
                // Deep merge needed generally, simplified here
                this.config.aiSettings = { ...DEFAULT_CONFIG.aiSettings, ...(parsed.aiSettings || {}) };
                this.config.queue = { ...DEFAULT_CONFIG.queue, ...(parsed.queue || {}) };
            } else {
                this.config = { ...DEFAULT_CONFIG };
                this.save();
            }
        } catch (e) {
            console.error('Failed to load config, resetting:', e);
            this.config = { ...DEFAULT_CONFIG };
        }
    }

    private static save() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (e) {
            console.error('Failed to save config:', e);
        }
    }

    static getSettings(): AppConfig {
        this.load();
        return this.config;
    }

    static updateSettings(partial: Partial<AppConfig>) {
        this.load();
        this.config = { ...this.config, ...partial };
        // Deep merge helper for nested updates to avoid overwrites if partial is used simply
        // Real implementation should be more robust
        this.save();
    }

    // For specific nested updates
    static updateQueueConfig(cfg: Partial<QueueConfig>) {
        this.load();
        this.config.queue = { ...this.config.queue, ...cfg };
        this.save();
    }

    // Legacy Helpers
    static getAISettings(): AISettings { return this.getSettings().aiSettings; }

    static setAISettings(settings: Partial<AISettings>) {
        this.load();
        this.config.aiSettings = { ...this.config.aiSettings, ...settings };
        this.save();
    }

    static getLibraryPath(): string {
        this.load();
        return this.config.libraryPath || path.join(app.getPath('userData'), 'Library');
    }

    static setLibraryPath(p: string) {
        this.updateSettings({ libraryPath: p });
    }
}
