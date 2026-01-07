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
            // DEBUG: Log every request (enable for troubleshooting)
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

            // Optimization: RAW Handling - Prefer Preview if available
            // This prevents expensive RAW decode by Sharp for thumbnails
            const ext = path.extname(filePath).toLowerCase();
            const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

            if (isRaw) {
                try {
                    const previewResponse = await this.attemptPreviewFallback(filePath, options, "Optimization: Use Preview");
                    if (previewResponse) return previewResponse;
                } catch (optErr) {
                    // Ignore optimization error, fall through to main process
                }
            }

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
            } catch (e: any) {
                if (e.code === 'ENOENT' || e.message.includes('ENOENT')) {
                    logger.warn(`[Protocol] Stale preview path detected and removed for ${filePath}`);
                    await this.repo.clearPreviewPath(filePath);
                    return null;
                }
                throw e;
            }
        }
        return null;
    }

    private async handleDirectRequest(filePath: string, _request: Request, _options: ProcessingOptions): Promise<Response> {
        const ext = path.extname(filePath).toLowerCase();
        const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

        // Check if this is a request for a preview file (not a RAW file)
        const isPreviewPath = filePath.includes('previews') && ext === '.jpg';

        if (isPreviewPath) {
            // Preview file requested directly
            try {
                await fs.access(filePath);
                const prevBuffer = await fs.readFile(filePath);
                return new Response(prevBuffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
            } catch (e) {
                // Preview file missing - look up original file and regenerate
                logger.warn(`[Protocol] Preview file missing, attempting regeneration: ${filePath}`);

                // Extract hash from preview filename to find original
                const match = filePath.match(/previews[\\/]([a-f0-9]+)\.jpg/i);
                if (match && match[1]) {
                    try {
                        const srcPath = await this.repo.getFilePathFromPreview(match[1]);
                        if (srcPath) {
                            logger.info(`[Protocol] Regenerating preview for: ${srcPath}`);

                            // Check if source is web-friendly - just serve it directly
                            const srcExt = path.extname(srcPath).toLowerCase();
                            const isWebFriendly = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(srcExt);

                            if (isWebFriendly) {
                                // Serve original file directly - no preview needed
                                logger.info(`[Protocol] Source is web-friendly, serving directly: ${srcPath}`);
                                try {
                                    await fs.access(srcPath);
                                    return await net.fetch(pathToFileURL(srcPath).toString());
                                } catch (srcErr) {
                                    logger.warn(`[Protocol] Source file also missing: ${srcPath}`);
                                    throw srcErr;
                                }
                            }

                            // Source is RAW - use Python to generate thumbnail
                            if (this.fallbackGenerator) {
                                try {
                                    const { orientation } = await this.repo.getImageMetadata(srcPath);
                                    logger.info(`[Protocol] Calling Python fallback for RAW: ${srcPath}`);
                                    const fbBuf = await this.fallbackGenerator(srcPath, 1280, undefined, orientation);
                                    if (fbBuf) {
                                        logger.info(`[Protocol] Python regeneration successful, returning ${fbBuf.length} bytes`);
                                        const response = new Response(fbBuf as any, {
                                            status: 200,
                                            headers: {
                                                'Content-Type': 'image/jpeg',
                                                'Content-Length': fbBuf.length.toString(),
                                                'Cache-Control': 'no-cache',
                                                'X-Generated-By': 'Python-Regenerated'
                                            }
                                        });
                                        logger.info(`[Protocol] Returning regenerated response for: ${filePath}`);
                                        return response;
                                    } else {
                                        logger.warn(`[Protocol] Python fallback returned null for: ${srcPath}`);
                                    }
                                } catch (pyErr) {
                                    logger.error(`[Protocol] Python fallback error for ${srcPath}:`, pyErr);
                                }
                            } else {
                                logger.warn(`[Protocol] No fallbackGenerator available for RAW regeneration`);
                            }
                        } else {
                            logger.warn(`[Protocol] Could not find source path for preview hash: ${match[1]}`);
                        }
                    } catch (regenErr) {
                        logger.warn(`[Protocol] Preview regeneration failed: ${regenErr}`);
                    }
                }
                throw e;
            }
        }

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

                // 2. On-the-fly Convert (Sharp may not support all RAW formats)
                // logger.info(`[Protocol] Converting RAW on-the-fly: ${filePath}`);
                try {
                    const buffer = await this.processor.convertRaw(filePath);
                    // logger.info(`[Protocol] Sharp conversion successful: ${buffer.length} bytes`);
                    return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                } catch (convErr) {
                    // Fallback to Python if Sharp/Libvips fails (e.g. unsupported RAW)
                    // logger.warn(`[Protocol] ConvertRaw failed, trying Python fallback: ${convErr}`);
                    if (this.fallbackGenerator) {
                        try {
                            // logger.info(`[Protocol] Calling Python fallback for: ${filePath}`);
                            const { orientation } = await this.repo.getImageMetadata(filePath);
                            // logger.info(`[Protocol] Got orientation: ${orientation}, calling fallbackGenerator...`);
                            const fbBuf = await this.fallbackGenerator(filePath, 1280, undefined, orientation);
                            if (fbBuf) {
                                // logger.info(`[Protocol] Python fallback success: ${fbBuf.length} bytes`);
                                return new Response(fbBuf as any, {
                                    headers: {
                                        'Content-Type': 'image/jpeg',
                                        'X-Generated-By': 'Python-Fallback-Direct'
                                    }
                                });
                            } else {
                                logger.warn(`[Protocol] Python fallback returned null`);
                            }
                        } catch (pyErr) {
                            logger.warn(`[Protocol] Python Fallback (Direct) failed: ${pyErr}`);
                        }
                    } else {
                        logger.warn(`[Protocol] No fallbackGenerator available!`);
                    }
                    throw convErr;
                }

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
