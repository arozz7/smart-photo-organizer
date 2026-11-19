import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import logger from '../../logger';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { ParkedFaceRepository } from '../../data/repositories/ParkedFaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { pythonProvider } from '../../infrastructure/PythonAIProvider';
import { collectCentroids } from './parkedFaces';
import { ParkedFaceSummaryService, type ParkedFaceSummaryDeps } from './ParkedFaceSummaryService';

const CACHE_KEY = 'parked_summary_cache';
const DESCRIPTOR_DIM = 512;
/** One request measures up to 8,000 faces against the whole library: a few seconds, well inside this. */
const REQUEST_TIMEOUT_MS = 120_000;

/** The real collaborators for ParkedFaceSummaryService. */
export function createParkedFaceSummaryDeps(): ParkedFaceSummaryDeps {
    return {
        getFingerprint: () => ParkedFaceRepository.getFingerprint(),
        loadFaces: () => ParkedFaceRepository.getUnassignedFaces(),
        getCentroids: () => collectCentroids(PersonRepository.getPeopleWithDescriptors(), DESCRIPTOR_DIM),
        withDataFiles: async (descriptors, shotIds, use) => {
            const stamp = Date.now();
            const descriptorsPath = path.join(os.tmpdir(), `spo_parked_${stamp}.f32`);
            const shotsPath = path.join(os.tmpdir(), `spo_parked_${stamp}.i32`);
            try {
                await fsPromises.writeFile(descriptorsPath, Buffer.concat(descriptors));
                await fsPromises.writeFile(shotsPath, Buffer.from(Int32Array.from(shotIds).buffer));
                return await use({ descriptorsPath, shotsPath });
            } finally {
                for (const file of [descriptorsPath, shotsPath]) {
                    try { await fsPromises.unlink(file); } catch { /* already gone */ }
                }
            }
        },
        requestNeighbourCounts: async request => {
            const response = await pythonProvider.sendRequest('face_neighbour_counts', request, REQUEST_TIMEOUT_MS);
            if (!response || response.error) {
                logger.warn(`[ParkedFaces] The AI backend could not count neighbours: ${response?.error ?? 'no answer'}`);
                return null;
            }
            return response;
        },
        isBusy: () => AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive(),
        readCache: () => AppStateRepository.getFlag(CACHE_KEY),
        writeCache: value => AppStateRepository.setFlag(CACHE_KEY, value),
        now: () => Date.now(),
    };
}

let service: ParkedFaceSummaryService | null = null;

/** The one summary service of the app (it holds the guard against two measurements at once). */
export function getParkedFaceSummaryService(): ParkedFaceSummaryService {
    if (!service) service = new ParkedFaceSummaryService(createParkedFaceSummaryDeps());
    return service;
}
