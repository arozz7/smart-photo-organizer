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
    runtimeUrl?: string;
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

/**
 * Settings for Smart Ignore features (Background Face Filter, Outlier Detection)
 * All thresholds are configurable with sensible defaults.
 */
export interface SmartIgnoreSettings {
    /** Faces appearing in fewer than this many photos are noise candidates. Default: 3 */
    minPhotoAppearances: number;
    /** Clusters with this many faces or fewer are noise candidates. Default: 2 */
    maxClusterSize: number;
    /** Faces further than this from any named person centroid are candidates. Default: 0.7 */
    centroidDistanceThreshold: number;
    /** Distance threshold for outlier (misassigned face) detection. Default: 1.2 */
    outlierThreshold: number;
}

export interface AppConfig {
    libraryPath: string;
    aiSettings: AISettings;
    windowBounds: WindowBounds;
    firstRun: boolean;
    queue: QueueConfig;
    smartIgnore: SmartIgnoreSettings;
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
        vlmEnabled: false, // Default to off for performance
        runtimeUrl: undefined
    },
    windowBounds: { width: 1200, height: 800, x: 0, y: 0 },
    firstRun: true,
    queue: { batchSize: 0, cooldownSeconds: 60 },
    smartIgnore: {
        minPhotoAppearances: 3,
        maxClusterSize: 2,
        centroidDistanceThreshold: 0.7,
        outlierThreshold: 1.2
    },
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
                // Deep merge nested objects
                this.config.aiSettings = { ...DEFAULT_CONFIG.aiSettings, ...(parsed.aiSettings || {}) };
                this.config.queue = { ...DEFAULT_CONFIG.queue, ...(parsed.queue || {}) };
                this.config.smartIgnore = { ...DEFAULT_CONFIG.smartIgnore, ...(parsed.smartIgnore || {}) };
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

    // Smart Ignore Helpers
    static getSmartIgnoreSettings(): SmartIgnoreSettings {
        return this.getSettings().smartIgnore;
    }

    static updateSmartIgnoreSettings(settings: Partial<SmartIgnoreSettings>) {
        this.load();
        this.config.smartIgnore = { ...this.config.smartIgnore, ...settings };
        this.save();
    }
}
