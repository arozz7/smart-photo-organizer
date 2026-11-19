/**
 * ConfigService precedence: values the user saved in the app win over the shipped ai-config.json,
 * and ai-config.json only supplies starting values. Its face detection score must never become the match distance.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as fs from 'node:fs';

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/mock/user/data') }
}));

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
}));

import { ConfigService } from '../../../../electron/core/services/ConfigService';

const AI_CONFIG = {
    face_detection: {
        score_threshold_confident: 0.85,
        face_blur_threshold: 15,
        score_threshold_reject: 0.4,
        score_threshold_accept: 0.7
    },
    vlm: { enabled: true, verification_threshold: 0.85 }
};

function mockFiles(userConfig: object | null) {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('ai-config') || userConfig !== null);
    vi.mocked(fs.readFileSync).mockImplementation((p) =>
        String(p).includes('ai-config') ? JSON.stringify(AI_CONFIG) : JSON.stringify(userConfig)
    );
}

describe('ConfigService precedence with ai-config.json', () => {
    let logSpy: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        (ConfigService as any).config = undefined;
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    it('keeps the value the user saved over the one in ai-config.json', () => {
        mockFiles({ aiSettings: { faceBlurThreshold: 30, vlmEnabled: false } });

        const settings = ConfigService.getSettings();

        expect(settings.aiSettings.faceBlurThreshold).toBe(30);
        expect(settings.aiSettings.vlmEnabled).toBe(false);
    });

    it('keeps the advanced face values the user saved over ai-config.json', () => {
        mockFiles({ advancedFace: { scoreThresholdAccept: 0.9 } });

        expect(ConfigService.getSettings().advancedFace.scoreThresholdAccept).toBe(0.9);
    });

    it('uses ai-config.json for a value the user has not saved', () => {
        mockFiles({ aiSettings: {} });

        const settings = ConfigService.getSettings();

        expect(settings.aiSettings.faceBlurThreshold).toBe(15);
        expect(settings.aiSettings.vlmEnabled).toBe(true);
    });

    it('does not turn the detection score score_threshold_confident into the match distance', () => {
        mockFiles({ aiSettings: {} });

        expect(ConfigService.getSettings().aiSettings.faceSimilarityThreshold).toBe(0.65);
    });

    it('keeps a match distance the user chose', () => {
        mockFiles({ aiSettings: { faceSimilarityThreshold: 0.7 } });

        expect(ConfigService.getSettings().aiSettings.faceSimilarityThreshold).toBe(0.7);
    });

    it('shows the auto-assign and review distances in effect', () => {
        mockFiles(null);

        const { aiSettings } = ConfigService.getSettings();

        expect(aiSettings.autoAssignThreshold).toBe(0.7);
        expect(aiSettings.reviewThreshold).toBe(0.9);
    });
});
