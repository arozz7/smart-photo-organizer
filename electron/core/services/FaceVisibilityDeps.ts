import fs from 'node:fs';
import { BACKGROUND } from '../interfaces/IAIProvider';
import { powerMonitor } from 'electron';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { VisibilityRepository, VISIBILITY_MODEL } from '../../data/repositories/VisibilityRepository';
import { pythonProvider } from '../../infrastructure/PythonAIProvider';
import { FaceVisibilityService, type FaceVisibilityDeps } from './FaceVisibilityService';
import { pickImagePath, scoreWithEngine } from './visibilityEngine';

/** The real collaborators for FaceVisibilityService. */
export function createFaceVisibilityDeps(): FaceVisibilityDeps {
    return {
        counts: () => VisibilityRepository.counts(),
        loadDue: limit => VisibilityRepository.loadDue(limit).map(face => ({
            id: face.id,
            // a face with no image at all is sent with an empty path: the engine reports it and it is recorded as failed
            imagePath: pickImagePath(face.previewPath, face.filePath, fs.existsSync) ?? '',
            photoWidth: face.photoWidth,
            box: face.box,
        })),
        score: faces => scoreWithEngine(faces, (type, payload, timeoutMs) => pythonProvider.sendRequest(type, payload, timeoutMs, BACKGROUND)),
        save: results => VisibilityRepository.save(results, VISIBILITY_MODEL, new Date().toISOString()),
        isBusy: () =>
            AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive() || AppStateRepository.isShutdownRequested(),
        idleSeconds: () => powerMonitor.getSystemIdleTime(),
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        now: () => Date.now(),
    };
}

let service: FaceVisibilityService | null = null;

/** The one scoring service of the app: the background loop and the Settings card share it. */
export function getFaceVisibilityService(): FaceVisibilityService {
    if (!service) service = new FaceVisibilityService(createFaceVisibilityDeps());
    return service;
}
