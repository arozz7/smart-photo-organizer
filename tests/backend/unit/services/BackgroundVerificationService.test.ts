import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stable mock objects
const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() }
};

const mockDestroyedWindow = {
    isDestroyed: vi.fn(() => true),
    webContents: { send: vi.fn() }
};

const mockPrepare = {
    run: vi.fn((..._args: any[]) => ({ lastInsertRowid: 1 }))
};

const mockDBInstance = {
    prepare: vi.fn(() => mockPrepare)
};

// Module mocks before imports
vi.mock('electron', () => ({
    BrowserWindow: {
        getAllWindows: vi.fn(() => [mockWindow])
    }
}));

vi.mock('../../../../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getSuspectFaces: vi.fn(() => []),
        countSuspectFaces: vi.fn(() => 0),
        ignoreFaces: vi.fn(),
        updateFaceEntityType: vi.fn(),
        updateFaceDemographics: vi.fn(),
        markFaceAsRejected: vi.fn(),
        incrementVerificationAttempts: vi.fn(() => 1),
        getFacesByPhoto: vi.fn(() => [])
    }
}));

vi.mock('../../../../electron/infrastructure/PythonAIProvider', () => ({
    pythonProvider: {
        verifyFace: vi.fn(),
        detectFacesInRegion: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/AppStateRepository', () => ({
    AppStateRepository: {
        isAIProcessingActive: vi.fn(() => false)
    }
}));

vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn(() => mockDBInstance)
}));

// Imports after mocks
import { BrowserWindow } from 'electron';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { pythonProvider } from '../../../../electron/infrastructure/PythonAIProvider';
import { AppStateRepository } from '../../../../electron/data/repositories/AppStateRepository';
import { BackgroundVerificationService } from '../../../../electron/core/services/BackgroundVerificationService';

// Test helper
function createSuspectFace(overrides: Record<string, any> = {}) {
    return {
        id: 1,
        photo_id: 100,
        box_json: '{"x":100,"y":100,"width":200,"height":250}',
        file_path: '/photos/test.jpg',
        score: 0.55,
        face_quality: 0.5,
        verification_attempts: 0,
        preview_cache_path: null,
        ...overrides
    };
}

describe('BackgroundVerificationService', () => {
    let service: BackgroundVerificationService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new BackgroundVerificationService();

        // Reset default mock returns
        vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([]);
        vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(0);
        vi.mocked(FaceRepository.incrementVerificationAttempts).mockReturnValue(1);
        vi.mocked(FaceRepository.getFacesByPhoto).mockReturnValue([]);
        vi.mocked(AppStateRepository.isAIProcessingActive).mockReturnValue(false);
        vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as any]);
    });

    describe('Phase 90 Core Logic — VLM as Negative Filter', () => {
        it('VLM says false → face is ignored (soft-deleted)', async () => {
            // Arrange
            const face = createSuspectFace();
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: false,
                confidence: 0.8,
                reason: 'rock'
            });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.ignoreFaces).toHaveBeenCalledWith([face.id]);
            expect(mockWindow.webContents.send).toHaveBeenCalledWith(
                'background-verification-result',
                { photoId: face.photo_id }
            );
            expect(FaceRepository.updateFaceEntityType).not.toHaveBeenCalled();
        });

        it('VLM says true (normal aspect) → face accepted as human', async () => {
            // Arrange
            const face = createSuspectFace(); // 200x250 = aspect 0.8
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: true,
                confidence: 0.9
            });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.updateFaceEntityType).toHaveBeenCalledWith(face.id, 'human');
            expect(FaceRepository.ignoreFaces).not.toHaveBeenCalled();
        });

        it('VLM says true with demographics → demographics applied', async () => {
            // Arrange
            const face = createSuspectFace();
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: true,
                confidence: 0.9,
                suggested_metadata: { gender: 'F', age: 30 }
            });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.updateFaceEntityType).toHaveBeenCalledWith(face.id, 'human');
            expect(FaceRepository.updateFaceDemographics).toHaveBeenCalledWith(
                face.id,
                { gender: 'F', age: 30 }
            );
        });

        it('VLM returns null (unknown/error) → face accepted as human', async () => {
            // Arrange
            const face = createSuspectFace();
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: null,
                error: 'VLM Generation Failure'
            });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.updateFaceEntityType).toHaveBeenCalledWith(face.id, 'human');
            expect(FaceRepository.ignoreFaces).not.toHaveBeenCalled();
            expect(FaceRepository.incrementVerificationAttempts).not.toHaveBeenCalled();
        });

        it('no suspect faces → batch is a no-op', async () => {
            // Arrange
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([]);

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(pythonProvider.verifyFace).not.toHaveBeenCalled();
        });
    });

    describe('Multi-Face Split Logic', () => {
        it('wide aspect ratio + multi-face detected → split', async () => {
            // Arrange: wide box (400x200, aspect 2.0)
            const face = createSuspectFace({
                box_json: '{"x":50,"y":50,"width":400,"height":200}'
            });
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: true,
                confidence: 0.85,
                suggested_metadata: { is_multi_face: true }
            });
            vi.mocked(pythonProvider.detectFacesInRegion).mockResolvedValue({
                faceCount: 2,
                faces: [
                    { box: { x: 60, y: 60, width: 150, height: 180 }, score: 0.8, embedding: null },
                    { box: { x: 280, y: 60, width: 150, height: 180 }, score: 0.75, embedding: null }
                ]
            });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.markFaceAsRejected).toHaveBeenCalledWith(face.id);
            expect(mockPrepare.run).toHaveBeenCalledTimes(2); // 2 new faces inserted
            expect(FaceRepository.updateFaceEntityType).not.toHaveBeenCalled();
        });

        it('multi-face hint but detector finds only 1 → keep as human', async () => {
            // Arrange
            const face = createSuspectFace({
                box_json: '{"x":50,"y":50,"width":400,"height":200}'
            });
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: true,
                confidence: 0.85,
                suggested_metadata: { is_multi_face: true }
            });
            // First call (default scale) returns 1, second call (640) also returns 1
            vi.mocked(pythonProvider.detectFacesInRegion)
                .mockResolvedValueOnce({
                    faceCount: 1,
                    faces: [{ box: { x: 60, y: 60, width: 150, height: 180 }, score: 0.8, embedding: null }]
                })
                .mockResolvedValueOnce({
                    faceCount: 1,
                    faces: [{ box: { x: 60, y: 60, width: 150, height: 180 }, score: 0.8, embedding: null }]
                });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.updateFaceEntityType).toHaveBeenCalledWith(face.id, 'human');
            expect(FaceRepository.markFaceAsRejected).not.toHaveBeenCalled();
        });

        it('multi-face retry at 640px scale finds more faces → split proceeds', async () => {
            // Arrange
            const face = createSuspectFace({
                box_json: '{"x":50,"y":50,"width":400,"height":200}'
            });
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: true,
                confidence: 0.85,
                suggested_metadata: { is_multi_face: true }
            });
            // First call returns 1 face, second (640 scale) returns 2
            vi.mocked(pythonProvider.detectFacesInRegion)
                .mockResolvedValueOnce({
                    faceCount: 1,
                    faces: [{ box: { x: 60, y: 60, width: 150, height: 180 }, score: 0.8, embedding: null }]
                })
                .mockResolvedValueOnce({
                    faceCount: 2,
                    faces: [
                        { box: { x: 60, y: 60, width: 150, height: 180 }, score: 0.8, embedding: null },
                        { box: { x: 280, y: 60, width: 150, height: 180 }, score: 0.75, embedding: null }
                    ]
                });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(pythonProvider.detectFacesInRegion).toHaveBeenCalledTimes(2);
            expect(pythonProvider.detectFacesInRegion).toHaveBeenLastCalledWith(
                face.file_path,
                expect.any(Object),
                expect.objectContaining({ detSize: [640, 640] })
            );
            expect(FaceRepository.markFaceAsRejected).toHaveBeenCalledWith(face.id);
            expect(mockPrepare.run).toHaveBeenCalledTimes(2);
        });
    });

    describe('Service Lifecycle', () => {
        it('pauses when scanning is active', async () => {
            // Arrange
            vi.mocked(AppStateRepository.isAIProcessingActive).mockReturnValue(true);

            // Act — call runLoop but stop after first iteration
            // We test via processNextBatch indirection through the loop
            // Instead, verify the guard in runLoop by checking getSuspectFaces is not called
            // We need to test the loop behavior, so we'll spy on sleep to break out
            const sleepSpy = vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
            (service as any).shouldStop = false;

            // Run one iteration then stop
            let iterationCount = 0;
            sleepSpy.mockImplementation(async () => {
                iterationCount++;
                if (iterationCount >= 1) {
                    (service as any).shouldStop = true;
                }
            });

            await (service as any).runLoop();

            // Assert
            expect(FaceRepository.getSuspectFaces).not.toHaveBeenCalled();
        });

        it('exception during processing → attempts incremented', async () => {
            // Arrange
            const face = createSuspectFace();
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockRejectedValue(new Error('VLM crash'));
            vi.mocked(FaceRepository.incrementVerificationAttempts).mockReturnValue(1);

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.incrementVerificationAttempts).toHaveBeenCalledWith(face.id);
        });

        it('max attempts reached → auto-rejected', async () => {
            // Arrange
            const face = createSuspectFace();
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockRejectedValue(new Error('VLM crash'));
            vi.mocked(FaceRepository.incrementVerificationAttempts).mockReturnValue(3);

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(FaceRepository.incrementVerificationAttempts).toHaveBeenCalledWith(face.id);
            expect(FaceRepository.markFaceAsRejected).toHaveBeenCalledWith(face.id);
        });
    });

    describe('IPC Notifications', () => {
        it('photo change notification sent to non-destroyed windows only', async () => {
            // Arrange
            vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
                mockWindow as any,
                mockDestroyedWindow as any
            ]);
            const face = createSuspectFace();
            vi.mocked(FaceRepository.getSuspectFaces).mockReturnValue([face as any]);
            vi.mocked(FaceRepository.countSuspectFaces).mockReturnValue(1);
            vi.mocked(pythonProvider.verifyFace).mockResolvedValue({
                is_face: false,
                confidence: 0.8,
                reason: 'statue'
            });

            // Act
            await (service as any).processNextBatch();

            // Assert
            expect(mockWindow.webContents.send).toHaveBeenCalledWith(
                'background-verification-result',
                { photoId: face.photo_id }
            );
            expect(mockDestroyedWindow.webContents.send).not.toHaveBeenCalled();
        });
    });
});
