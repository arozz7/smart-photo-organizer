import { net } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import logger from '../../logger';
import { FallbackGenerator, IImageProcessor, IMetadataRepository, ProcessingOptions } from './interfaces';

const TRANSPARENT_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export class ImageService {
    constructor(
        private repo: IMetadataRepository,
        private processor: IImageProcessor,
        private fallbackGenerator?: FallbackGenerator
    ) { }

    async processRequest(request: Request): Promise<Response> {
        let decodedPath = '';
        try {
            // DEBUG: Log every request (Commented out in original)
            // logger.info(`[Protocol] Incoming: ${request.url}`);

            const urlObj = new URL(request.url);

            // 1. Strip protocol & Decode
            const rawPath = request.url.replace(/^local-resource:\/\//, '');
            decodedPath = decodeURIComponent(rawPath);

            // 3. Strip query string
            const queryIndex = decodedPath.indexOf('?');
            if (queryIndex !== -1) {
                decodedPath = decodedPath.substring(0, queryIndex);
            }

            // 4. Strip trailing slash
            if (decodedPath.endsWith('/') || decodedPath.endsWith('\\')) {
                decodedPath = decodedPath.slice(0, -1);
            }

            // Parse Options
            const width = urlObj.searchParams.get('width') ? parseInt(urlObj.searchParams.get('width')!) : undefined;
            const originalWidth = urlObj.searchParams.get('originalWidth') ? parseInt(urlObj.searchParams.get('originalWidth')!) : undefined;
            const boxParam = urlObj.searchParams.get('box');
            const hq = urlObj.searchParams.get('hq') === 'true';
            const silent_404 = request.url.includes('silent_404=true'); // or param
            const photoIdParam = urlObj.searchParams.get('photoId');

            let box: { x: number, y: number, w: number, h: number } | undefined;
            if (boxParam) {
                const parts = boxParam.split(',').map(Number);
                if (parts.length === 4 && parts.every(n => !isNaN(n))) {
                    box = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
                }
            }

            const options: ProcessingOptions = {
                width,
                originalWidth,
                box,
                hq,
                silent_404,
                photoId: photoIdParam ? parseInt(photoIdParam) : undefined
            };

            // BRANCH: Resize/Crop Request
            if ((width && width > 0) || box) {
                return await this.handleResizeRequest(decodedPath, options);
            }

            // BRANCH: Direct File Access (No Resize)
            return await this.handleDirectRequest(decodedPath, request, options);

        } catch (e: any) {
            return this.handleGlobalError(e, decodedPath, request);
        }
    }

    private async handleResizeRequest(filePath: string, options: ProcessingOptions): Promise<Response> {
        try {
            // 1. Fetch DB Orientation
            const { orientation } = await this.repo.getImageMetadata(filePath);

            // 2. Process with Sharp
            const buffer = await this.processor.process(filePath, options, orientation);

            return new Response(buffer as any, {
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'max-age=3600'
                }
            });

        } catch (resizeErr: any) {
            const errMessage = resizeErr.message || String(resizeErr);
            // logger.warn(`[Protocol] Transform failed for ${filePath}: ${errMessage}`);

            // 3. FALLBACK: Generated Preview
            try {
                const previewResponse = await this.attemptPreviewFallback(filePath, options, errMessage);
                if (previewResponse) return previewResponse;
            } catch (fbErr) {
                logger.warn(`[Protocol] Preview fallback failed for ${filePath}: ${fbErr}`);
            }

            // 4. FALLBACK: Python (for RAW)
            // Note: Original code tried "Inner Recovery" (Line 240) to find source from preview path
            // But here we are in handleResizeRequest, usually processing `filePath` which IS the source.
            // Start with Python fallback check for RAW files.

            const ext = path.extname(filePath).toLowerCase();
            const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

            if (isRaw && this.fallbackGenerator) {
                try {
                    const { orientation } = await this.repo.getImageMetadata(filePath);
                    const boxStr = options.box ? `${options.box.x},${options.box.y},${options.box.w},${options.box.h}` : undefined;
                    const fbWidth = options.width || 300;

                    const fbBuffer = await this.fallbackGenerator(filePath, fbWidth, boxStr, orientation);
                    if (fbBuffer) {
                        return new Response(fbBuffer as any, {
                            headers: {
                                'Content-Type': 'image/jpeg',
                                'X-Generated-By': 'Python-Fallback'
                            }
                        });
                    }
                } catch (pyErr) {
                    logger.warn(`[Protocol] Python Fallback (Resize) failed: ${pyErr}`);
                }
            }

            // Silent 404 check
            if (options.silent_404) {
                return this.serveTransparent();
            }

            // Log Error to DB
            if (options.photoId) {
                await this.repo.logError(options.photoId, filePath, errMessage, 'Preview Generation');
            } else {
                // Try to find ID
                const id = await this.repo.getPhotoId(filePath);
                if (id) await this.repo.logError(id, filePath, errMessage, 'Preview Generation');
            }

            return new Response('Thumbnail Generation Failed', { status: 500 });
        }
    }

    private async attemptPreviewFallback(filePath: string, options: ProcessingOptions, _originalError: string): Promise<Response | null> {
        // Check DB for preview path
        const previewPath = await this.repo.getPreviewPath(filePath);

        if (previewPath && !options.hq) {
            try {
                // Verify access
                await fs.access(previewPath);

                // Use simple processing on preview
                // Note: Previews are JPEGs
                // Pass 'originalWidth' in options to allow 'process' to scale box if needed (ImageProcessor handles this now logic-wise? 
                // Wait, I implemented scaling logic in ImageProcessor based on 'currentW'.
                // So if we pass the preview file to processor, it sees preview dimensions.
                // We pass 'options.originalWidth'. Processor calculates scale. CORRECT.

                const buffer = await this.processor.process(previewPath, options, 1); // Preview usually already oriented? Or 1?
                // Original code: sharp(previewPath).rotate(); -> Auto-rotates based on EXIF in preview?
                // Previews generated by Python usually lack EXIF or are already upright. 
                // Let's assume defaults.

                return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
            } catch (e) {
                throw e;
            }
        }
        return null;
    }

    private async handleDirectRequest(filePath: string, _request: Request, _options: ProcessingOptions): Promise<Response> {
        const ext = path.extname(filePath).toLowerCase();
        const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

        if (isRaw) {
            // RAW Handling
            try {
                // 1. Preview
                const previewPath = await this.repo.getPreviewPath(filePath);
                if (previewPath) {
                    try {
                        await fs.access(previewPath);
                        const prevBuffer = await fs.readFile(previewPath);
                        return new Response(prevBuffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                    } catch (e) {
                        logger.warn(`[Protocol] RAW Preview found but inaccessible: ${previewPath}`);
                    }
                }

                // 2. On-the-fly Convert
                // logger.info(`[Protocol] Converting RAW on-the-fly: ${filePath}`);
                const buffer = await this.processor.convertRaw(filePath);
                return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });

            } catch (rawErr) {
                logger.error(`[Protocol] Failed to serve RAW file ${filePath}:`, rawErr);
                throw rawErr; // Trigger global error handler
            }
        }

        // Standard File
        try {
            await fs.access(filePath);
            return await net.fetch(pathToFileURL(filePath).toString());
        } catch (fsErr) {
            throw fsErr;
        }
    }

    private async handleGlobalError(e: any, decodedPath: string, request: Request): Promise<Response> {
        const msg = e.message || String(e);
        const isSilent404 = request.url.includes('silent_404=true');

        // RECOVERY: Preview -> Original
        // If we requested a Preview file directly (not via DB lookup, but literally the path to a preview file) and it failed.
        if (msg.includes('ERR_FILE_NOT_FOUND') || msg.includes('ENOENT')) {
            const match = decodedPath.match(/previews[\\\/]([a-f0-9]+)\.jpg/);
            if (match && match[1]) {
                try {
                    const srcPath = await this.repo.getFilePathFromPreview(match[1]);
                    if (srcPath) {
                        // Serve Original Logic
                        // If RAW, customize.
                        const ext = path.extname(srcPath).toLowerCase();
                        const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

                        if (isRaw) {
                            try {
                                // Convert RAW
                                const buffer = await this.processor.convertRaw(srcPath);
                                return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                            } catch (rawErr) {
                                // Sibling Check?
                                // Original code checked for siblings here (Lines 456-470)
                                const buffer = await this.attemptSiblingRecovery(srcPath);
                                if (buffer) return new Response(buffer as any, { headers: { 'Content-Type': 'image/zip' } }); // Mime? fetch uses auto. Here we fallback to fetch.

                                // Python Fallback for Recovery
                                if (this.fallbackGenerator) {
                                    const urlObj = new URL(request.url);
                                    const width = urlObj.searchParams.get('width') ? parseInt(urlObj.searchParams.get('width')!) : 300;
                                    const fbBuf = await this.fallbackGenerator(srcPath, width);
                                    if (fbBuf) return new Response(fbBuf as any, { headers: { 'Content-Type': 'image/jpeg', 'X-Generated-By': 'Python-Fallback' } });
                                }
                                throw rawErr;
                            }
                        } else {
                            // Non-Raw Original
                            return await net.fetch(pathToFileURL(srcPath).toString());
                        }
                    }
                } catch (recErr) {
                    logger.warn(`[Protocol] Recovery failed: ${recErr}`);
                }
            }
        }

        if (msg.includes('ERR_FILE_NOT_FOUND') || msg.includes('ENOENT')) {
            if (isSilent404) {
                return this.serveTransparent();
            }
            // logger.info(`[Protocol] File missing: ${decodedPath}`);
        } else {
            logger.error(`[Protocol] Failed to handle request: ${request.url}`, e);
        }

        return new Response('Not Found', { status: 404 });
    }

    private serveTransparent(): Response {
        return new Response(TRANSPARENT_1X1_PNG, {
            status: 200,
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'no-cache'
            }
        });
    }

    // Helper for Sibling Recovery logic (Lines 456-470)
    private async attemptSiblingRecovery(srcPath: string): Promise<Response | null> {
        const jpgSiblings = [
            srcPath.replace(/\.[^.]+$/, '.JPG'),
            srcPath.replace(/\.[^.]+$/, '.jpg'),
            srcPath + '.JPG',
            srcPath + '.jpg'
        ];

        for (const sib of jpgSiblings) {
            if (sib === srcPath) continue;
            try {
                await fs.access(sib);
                return await net.fetch(pathToFileURL(sib).toString());
            } catch { /* ignore */ }
        }
        return null;
    }
}
