import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FaceAnalysisService } from '../../../../electron/core/services/FaceAnalysisService';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';

vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp/test-data',
        getAppPath: () => '/tmp/test-app'
    },
    ipcMain: { handle: vi.fn(), on: vi.fn() }
}));

vi.mock('../../../../../electron/data/repositories/FaceRepository');
vi.mock('../../../../../electron/data/repositories/PersonRepository');

describe('FaceAnalysisService', () => {
    describe('getQualityAdjustedThreshold', () => {
        it('should return base threshold for average quality (0.6)', () => {
            const result = FaceAnalysisService.getQualityAdjustedThreshold(0.7, 0.6);
            expect(result).toBe(0.7);
        });

        it('should relax threshold for low quality faces (0.3)', () => {
            const result = FaceAnalysisService.getQualityAdjustedThreshold(0.7, 0.2);
            // (0.6 - 0.2) * 0.25 = 0.4 * 0.25 = 0.1
            // 0.7 + 0.1 = 0.8
            expect(result).toBeCloseTo(0.8, 2);
        });

        it('should tighten threshold for high quality faces (0.9)', () => {
            const result = FaceAnalysisService.getQualityAdjustedThreshold(0.7, 1.0);
            // (0.6 - 1.0) * 0.25 = -0.4 * 0.25 = -0.1
            // 0.7 - 0.1 = 0.6
            expect(result).toBeCloseTo(0.6, 2);
        });

        it('should clamp to min 0.3', () => {
            const result = FaceAnalysisService.getQualityAdjustedThreshold(0.1, 1.0);
            expect(result).toBeGreaterThanOrEqual(0.3);
        });

        it('should clamp to max 0.9', () => {
            const result = FaceAnalysisService.getQualityAdjustedThreshold(0.85, 0.0);
            expect(result).toBeLessThanOrEqual(0.9);
        });
    });

    describe('consensusVoting', () => {
        it('should return null for empty matches', () => {
            expect(FaceAnalysisService.consensusVoting([])).toBeNull();
        });

        it('should return single match if only one provided', () => {
            const matches = [{ personId: 1, distance: 0.5 }];
            const result = FaceAnalysisService.consensusVoting(matches);
            expect(result?.personId).toBe(1);
            expect(result?.distance).toBe(0.5);
        });

        it('should pick candidate with most votes', () => {
            const matches = [
                { personId: 1, distance: 0.6 },
                { personId: 2, distance: 0.5 }, // P2 is closer, but single
                { personId: 1, distance: 0.65 },
                { personId: 1, distance: 0.7 }
            ];
            // P1: 3 votes. P2: 1 vote.
            // P2 weight: 1/(1+0.25) = 0.8.
            // P1 weights: ~0.73 + ~0.7 + ~0.67 = 2.1.
            const result = FaceAnalysisService.consensusVoting(matches);
            expect(result?.personId).toBe(1);
            expect(result?.distance).toBe(0.6); // Best distance of winner
        });

        it('should favor closer matches when vote counts are equal', () => {
            const matches = [
                { personId: 1, distance: 0.8 },
                { personId: 2, distance: 0.1 }
            ];
            // P1 weight: 1/(1+0.64)=0.6.
            // P2 weight: 1/(1+0.01)=0.99.
            const result = FaceAnalysisService.consensusVoting(matches);
            expect(result?.personId).toBe(2);
        });

        it('should resolve outlier pollution correctly', () => {
            // Scenario: 4 matches for P1 (the real person) but 1 accidental very close match for P2 (noise)
            const matches = [
                { personId: 1, distance: 0.4 },
                { personId: 1, distance: 0.42 },
                { personId: 1, distance: 0.45 },
                { personId: 1, distance: 0.48 }, // Dense cluster
                { personId: 2, distance: 0.35 }  // Single close match (outlier)
            ];

            const result = FaceAnalysisService.consensusVoting(matches);
            expect(result?.personId).toBe(1);
        });
    });
});
