import fs from 'node:fs';
import { powerMonitor } from 'electron';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PictureRepository, PICTURE_MODEL } from '../../data/repositories/PictureRepository';
import { pythonProvider } from '../../infrastructure/PythonAIProvider';
import { FaceVisibilityService, type FaceVisibilityDeps } from './FaceVisibilityService';
import { pickImagePath, scoreWithEngine } from './visibilityEngine';

/** The real collaborators for the picture check (the same service as the face visibility check, asking another question of the engine). */
export function createPictureCheckDeps(): FaceVisibilityDeps {
    return {
        counts: () => {
            const { candidates, scored, failed } = PictureRepository.counts();
            return { candidates, scored, failed };
        },
        loadDue: limit => PictureRepository.loadDue(limit).map(face => ({
            id: face.id,
            // a face with no image at all is sent with an empty path: the engine reports it and it is recorded as failed
            imagePath: pickImagePath(face.previewPath, face.filePath, fs.existsSync) ?? '',
            photoWidth: face.photoWidth,
            box: face.box,
        })),
        score: faces => scoreWithEngine(faces, (type, payload, timeoutMs) => pythonProvider.sendRequest(type, payload, timeoutMs), 'score_face_picture'),
        save: results => PictureRepository.save(results, PICTURE_MODEL, new Date().toISOString()),
        isBusy: () =>
            AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive() || AppStateRepository.isShutdownRequested(),
        idleSeconds: () => powerMonitor.getSystemIdleTime(),
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        now: () => Date.now(),
    };
}

let service: FaceVisibilityService | null = null;

/** The one picture check of the app: the background loop and the Settings card share it. Its own mode and away time, its own log lines. */
export function getPictureCheckService(): FaceVisibilityService {
    if (!service) service = new FaceVisibilityService(createPictureCheckDeps(), { modeKey: 'picture_mode', awayKey: 'picture_away_minutes', logTag: 'PictureCheck' });
    return service;
}
