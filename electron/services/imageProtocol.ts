import { protocol } from 'electron';
import { ImageService } from './image/ImageService';
import { SqliteMetadataRepository } from './image/MetadataRepository';
import { SharpImageProcessor } from './image/ImageProcessor';
import { FallbackGenerator } from './image/interfaces';

// Fallback generator provided by main process (calls Python)
export function registerImageProtocol(fallbackGenerator?: FallbackGenerator) {

    // Instantiate Dependencies
    const repo = new SqliteMetadataRepository();
    const processor = new SharpImageProcessor();
    const service = new ImageService(repo, processor, fallbackGenerator);

    protocol.handle('local-resource', async (request) => {
        return await service.processRequest(request);
    });
}
