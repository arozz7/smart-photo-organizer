import { app } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs';

// Phase 104: Strict False Positive Mode — threshold constants
// Default mode uses 0.70. When strictFalsePositiveMode is enabled (Phase 6 toggle),
// scoreThresholdAccept is raised to this value to reduce cartoon/object false positives.
export const STRICT_SCORE_THRESHOLD_ACCEPT = 0.75;

// Define Schema Interfaces
export interface AISettings {
    faceSimilarityThreshold: number;
    faceBlurThreshold: number;
    minFaceSize: number;
    modelSize: 'small' | 'medium' | 'large';
    aiProfile: 'fast' | 'balanced' | 'high';
    useGpu: boolean;
    vlmEnabled: boolean;
    vlmVerificationThreshold?: number; // Default 0.65 - faces below this score are marked as 'suspect' for VLM verification
    runtimeUrl?: string;
    // L2 distance thresholds for scan-time face classification
    autoAssignThreshold?: number;  // Default 0.7 - faces below this are auto-assigned
    reviewThreshold?: number;      // Default 0.9 - faces below this are review tier
    // Era Generation
    minFacesForEra?: number;       // Default 50
    eraMergeThreshold?: number;    // Default 0.75
}

export interface AdvancedFaceConfig {
    // Detection
    detThreshStandard: number; // Default 0.65
    detThreshMacro: number;    // Default 0.25 (New default)

    // Filter
    minFaceSize: number;       // Default 40

    // NMS
    nmsIouThresh: number;      // Default 0.3 (Standard overlap)
    nmsIoMinThresh: number;    // Default 0.65 (Containment)
    dedupIoUThresh?: number;   // Default 0.55 (Deduplication overlap)
    enableAreaBasedNMS: boolean; // Default true (for size prioritization)

    // Scan Scales (Simplified for UI)
    enableMacroLowRes: boolean; // Enable 160px pass?
    enableTTA: boolean;         // Enable rotation augmentation?

    // [Phase 74] High-Quality Face Threshold
    // Faces with faceQuality > this are kept even if detection score is low
    highQualityFaceThreshold?: number; // Default 0.70

    // [Phase 79] Large Face Threshold (Web Size)
    // Faces larger than this (width or height) are kept even if detection score is low
    largeFaceThreshold?: number; // Default 300

    // [Phase 90] 3-Tier Detection Score System
    scoreThresholdReject?: number;  // Default 0.40 — below this, auto-reject
    scoreThresholdAccept?: number;  // Default 0.70 — above this, auto-accept as human

    // [Phase 104] Strict False Positive Mode
    // When true: scoreThresholdAccept=0.75, anchor_only_frontal=true in clustering
    strictFalsePositiveMode?: boolean; // Default false
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
    /** Confidence threshold for auto-assigning High Tier faces (e.g. 0.4). Default: 0.4 */
    autoAssignThreshold: number;
    /** Confidence threshold for Review Tier faces (e.g. 0.6). Default: 0.6 */
    reviewThreshold: number;
    /** Whether to enable scan-time auto-tiering. Default: true */
    enableAutoTiering: boolean;
    // Phase 5: Challenging Face Recognition
    enableMultiSampleVoting: boolean;
    maxSamplesPerPerson: number;
    enableQualityAdjustedThresholds: boolean;
    lowQualityThresholdBoost: number;
    /** Faces farther than this L2 distance from any named person go to Ungroupable. Default: 1.0 */
    ungroupableDistanceThreshold: number;
}

export interface DashboardWidgetConfig {
    id: string;
    enabled: boolean;
    size: '1x1' | '2x1' | '2x2';
}

export interface DashboardConfig {
    widgets: DashboardWidgetConfig[];
    preset: 'minimal' | 'balanced' | 'power';
    reduceMotion: boolean;
}

export interface AppConfig {
    libraryPath: string;
    advancedFace: AdvancedFaceConfig;
    aiSettings: AISettings;
    windowBounds: WindowBounds;
    firstRun: boolean;
    queue: QueueConfig;
    smartIgnore: SmartIgnoreSettings;
    dashboard: DashboardConfig;
    ai_queue: any[]; // Queue items
    faissStaleCount?: number; // Tracks faces removed that need FAISS rebuild
    prsExecutablePath?: string; // Path to the Photo Repair Shop executable
}

// Default Config
export const DEFAULT_CONFIG: AppConfig = {
    libraryPath: '',
    advancedFace: {
        detThreshStandard: 0.65,
        detThreshMacro: 0.25,
        minFaceSize: 40,
        nmsIouThresh: 0.3,
        nmsIoMinThresh: 0.65,
        enableAreaBasedNMS: true,
        enableMacroLowRes: true,
        enableTTA: true,
        highQualityFaceThreshold: 0.65, // [Phase 74] Faces with quality > this bypass low detection score filter
        largeFaceThreshold: 300,        // [Phase 79] Default
        scoreThresholdReject: 0.40,     // [Phase 90] Below this → auto-reject
        scoreThresholdAccept: 0.70,     // [Phase 90] Above this → auto-accept as human
        strictFalsePositiveMode: false  // [Phase 104] Off by default
    },
    aiSettings: {
        faceSimilarityThreshold: 0.65,
        faceBlurThreshold: 20,
        minFaceSize: 40,
        modelSize: 'medium',
        aiProfile: 'balanced',
        useGpu: true,
        vlmEnabled: false, // Default to off for performance
        vlmVerificationThreshold: 0.85, // Phase 56: VLM Verification threshold
        runtimeUrl: undefined
    },
    windowBounds: { width: 1200, height: 800, x: 0, y: 0 },
    firstRun: true,
    queue: { batchSize: 0, cooldownSeconds: 60 },
    smartIgnore: {
        minPhotoAppearances: 3,
        maxClusterSize: 2,
        centroidDistanceThreshold: 0.7,
        outlierThreshold: 1.2,
        autoAssignThreshold: 0.4,
        reviewThreshold: 0.6,
        enableAutoTiering: true,
        enableMultiSampleVoting: true,
        maxSamplesPerPerson: 50,
        enableQualityAdjustedThresholds: true,
        lowQualityThresholdBoost: 0.15,
        ungroupableDistanceThreshold: 1.0
    },
    dashboard: {
        widgets: [
            { id: 'scanEntertainment', enabled: true, size: '2x1' },
            { id: 'onThisDay', enabled: true, size: '2x1' },
            { id: 'libraryStats', enabled: true, size: '1x1' },
            { id: 'peopleSpotlight', enabled: true, size: '2x1' },
            { id: 'recentActivity', enabled: true, size: '1x1' },
            { id: 'funFacts', enabled: true, size: '1x1' },
            { id: 'timeline', enabled: true, size: '2x1' },
            { id: 'libraryHealth', enabled: false, size: '1x1' },
            { id: 'collage', enabled: false, size: '2x1' },
            { id: 'locationHeatmap', enabled: false, size: '2x1' },
        ],
        preset: 'balanced',
        reduceMotion: false,
    },
    ai_queue: []
};

export class ConfigService {
    private static configPath = path.join(app.getPath('userData'), 'config.json');
    private static config: AppConfig;

    private static load() {
        if (this.config) return;
        try {
            // [Phase 66] Load Enterprise Defaults from ai-config.json
            let enterpriseDefaults = {};
            const aiConfigPath = path.join(process.cwd(), 'ai-config.json');

            try {
                if (fs.existsSync(aiConfigPath)) {
                    const aiRaw = fs.readFileSync(aiConfigPath, 'utf8');
                    const aiJson = JSON.parse(aiRaw);

                    // Map ai-config.json to AppConfig structure
                    enterpriseDefaults = {
                        advancedFace: {
                            detThreshStandard: aiJson.face_detection?.score_threshold_strict ?? 0.40, // [Phase 90] Aligned with reject floor
                            minFaceSize: aiJson.face_detection?.min_face_size_standard ?? 40,
                            nmsIouThresh: aiJson.face_detection?.nms_iou_threshold ?? 0.3,
                            dedupIoUThresh: aiJson.face_detection?.deduplication_iou_threshold ?? 0.55,
                            enableTTA: aiJson.face_detection?.enable_tta ?? false,
                            largeFaceThreshold: aiJson.face_detection?.large_face_threshold ?? 300,
                            scoreThresholdReject: aiJson.face_detection?.score_threshold_reject ?? 0.40, // [Phase 90]
                            scoreThresholdAccept: aiJson.face_detection?.score_threshold_accept ?? 0.70  // [Phase 90]
                        },
                        aiSettings: {
                            vlmVerificationThreshold: aiJson.vlm?.verification_threshold ?? 0.85,
                            faceSimilarityThreshold: aiJson.face_detection?.score_threshold_confident ?? 0.85, // Use confident threshold as similarity baseline
                            faceBlurThreshold: aiJson.face_detection?.face_blur_threshold ?? 15,
                            vlmEnabled: aiJson.vlm?.enabled ?? false
                        }
                    };
                    console.log('[ConfigService] Loaded Enterprise Defaults from ai-config.json');
                }
            } catch (aiErr) {
                console.warn('[ConfigService] Failed to load ai-config.json, using hardcoded defaults:', aiErr);
            }

            // Merge: Hardcoded Defaults -> User Config -> Enterprise Defaults (Policy Enforcement)
            const baseConfig = { ...DEFAULT_CONFIG };
            let userConfig = {};

            if (fs.existsSync(this.configPath)) {
                try {
                    const raw = fs.readFileSync(this.configPath, 'utf8');
                    userConfig = JSON.parse(raw);
                } catch (e) {
                    console.error('Failed to parse user config:', e);
                }
            } else {
                // Save defaults if no config exists
                this.config = { ...baseConfig };
                this.save();
                // But we still want to apply enterprise defaults below
            }

            // 1. Apply User Config on top of Base
            let intermediateConfig = { ...baseConfig, ...userConfig };
            // Deep merge nested objects
            intermediateConfig.aiSettings = { ...baseConfig.aiSettings, ...(userConfig as any).aiSettings || {} };
            intermediateConfig.advancedFace = { ...baseConfig.advancedFace, ...(userConfig as any).advancedFace || {} };
            intermediateConfig.queue = { ...baseConfig.queue, ...(userConfig as any).queue || {} };
            intermediateConfig.smartIgnore = { ...baseConfig.smartIgnore, ...(userConfig as any).smartIgnore || {} };
            intermediateConfig.dashboard = { ...baseConfig.dashboard, ...(userConfig as any).dashboard || {} };
            // Preserve widget array from user config if present, otherwise use defaults
            if ((userConfig as any).dashboard?.widgets) {
                intermediateConfig.dashboard.widgets = (userConfig as any).dashboard.widgets;
            }

            // 2. Apply Enterprise Defaults (ai-config.json) as FINAL OVERRIDE for specific tuned keys
            if (enterpriseDefaults) {
                // Deep merge specific sections
                intermediateConfig.advancedFace = {
                    ...intermediateConfig.advancedFace,
                    ...((enterpriseDefaults as any).advancedFace || {})
                };
                intermediateConfig.aiSettings = {
                    ...intermediateConfig.aiSettings,
                    ...((enterpriseDefaults as any).aiSettings || {})
                };
            }

            this.config = intermediateConfig as AppConfig;
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

    static getAdvancedFaceSettings(): AdvancedFaceConfig {
        return this.getSettings().advancedFace;
    }

    static setAdvancedFaceSettings(settings: Partial<AdvancedFaceConfig>) {
        this.load();
        this.config.advancedFace = { ...this.config.advancedFace, ...settings };
        this.save();

        // [Phase 106] Sync score_threshold_accept to ai-config.json so Python reads
        // the correct threshold when strictFalsePositiveMode changes.
        if ('strictFalsePositiveMode' in settings) {
            this.syncScoreThresholdToAiConfig(settings.strictFalsePositiveMode ?? false);
        }
    }

    private static syncScoreThresholdToAiConfig(strictMode: boolean): void {
        try {
            const aiConfigPath = path.join(process.cwd(), 'ai-config.json');
            let aiJson: Record<string, any> = {};
            if (fs.existsSync(aiConfigPath)) {
                aiJson = JSON.parse(fs.readFileSync(aiConfigPath, 'utf8'));
            }
            if (!aiJson.face_detection) aiJson.face_detection = {};
            aiJson.face_detection.score_threshold_accept = strictMode
                ? STRICT_SCORE_THRESHOLD_ACCEPT
                : (this.config.advancedFace.scoreThresholdAccept ?? 0.70);
            fs.writeFileSync(aiConfigPath, JSON.stringify(aiJson, null, 2), 'utf8');
            console.log(`[ConfigService] Synced score_threshold_accept=${aiJson.face_detection.score_threshold_accept} to ai-config.json (strictMode=${strictMode})`);
        } catch (e) {
            console.error('[ConfigService] Failed to sync score_threshold_accept to ai-config.json:', e);
        }
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

    // Dashboard Helpers
    static getDashboardConfig(): DashboardConfig {
        return this.getSettings().dashboard;
    }

    static updateDashboardConfig(config: Partial<DashboardConfig>) {
        this.load();
        this.config.dashboard = { ...this.config.dashboard, ...config };
        if (config.widgets) {
            this.config.dashboard.widgets = config.widgets;
        }
        this.save();
    }
}
