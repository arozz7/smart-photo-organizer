import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import logger from '../../logger';
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { NamedFaceFingerprintRepository } from '../../data/repositories/NamedFaceFingerprintRepository';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { pythonProvider } from '../../infrastructure/PythonAIProvider';
import { resetFaissStaleCount } from '../../store';
import type { FaissSyncDeps } from './BackgroundFaissSyncService';

const SYNCED_FINGERPRINT_KEY = 'faiss_synced_fingerprint';

/**
 * Rebuilds the face search index from the faces that belong to named people.
 *
 * Only named faces go in: matches must return faces whose person is known (used for auto-assign).
 * Returns the AI backend's answer; throws if the data could not be written or sent.
 */
export async function rebuildFaceIndexFromNamedFaces(): Promise<any> {
    const faces = FaceRepository.getNamedFaceDescriptors();
    logger.info(`[Main] Rebuilding FAISS index with ${faces.length} named person faces`);

    // Stream the JSON to a file: JSON.stringify of tens of thousands of faces exceeds JavaScript's string limit.
    const dataPath = path.join(os.tmpdir(), `spo_rebuild_index_${Date.now()}.json`);
    let result: any;
    try {
        const writeStream = fs.createWriteStream(dataPath, { encoding: 'utf-8' });

        await new Promise<void>((resolve, reject) => {
            writeStream.on('error', reject);
            writeStream.write('{"faces":[');
            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                if (i > 0) writeStream.write(',');
                writeStream.write(JSON.stringify({ id: face.id, descriptor: face.descriptor }));
            }
            writeStream.write(']}');
            writeStream.end(() => resolve());
        });

        logger.info(`[Main] Wrote ${faces.length} faces to temp file for rebuild`);
        result = await pythonProvider.sendRequest('rebuild_index', { dataPath }, 600000);
    } finally {
        try { await fsPromises.unlink(dataPath); } catch { /* ignore */ }
    }

    // Reset stale count after successful rebuild
    if (result && result.success !== false) {
        resetFaissStaleCount();
        logger.info('[Main] FAISS stale count reset after successful rebuild');
    }
    return result;
}

/** The real collaborators for BackgroundFaissSyncService. */
export function createFaissSyncDeps(): FaissSyncDeps {
    return {
        getNamedFaceFingerprint: () => NamedFaceFingerprintRepository.get(),
        getIndexVectorCount: async () => {
            try {
                const response: any = await pythonProvider.sendRequest('get_index_status', {}, 30_000);
                const count = response?.status?.total_vectors;
                return typeof count === 'number' ? count : null;
            } catch {
                return null;
            }
        },
        rebuildIndex: async () => {
            const result = await rebuildFaceIndexFromNamedFaces();
            return Boolean(result) && result.success !== false && !result.error;
        },
        isBusy: () => AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive(),
        isShutdownRequested: () => AppStateRepository.isShutdownRequested(),
        getSyncedFingerprint: () => AppStateRepository.getFlag(SYNCED_FINGERPRINT_KEY),
        setSyncedFingerprint: value => AppStateRepository.setFlag(SYNCED_FINGERPRINT_KEY, value),
        now: () => Date.now(),
    };
}
