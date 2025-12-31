import { protocol, net } from 'electron';
import sharp from 'sharp';
import logger from '../logger';
import { getDB } from '../db';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Base64 for 1x1 transparent PNG
const TRANSPARENT_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Fallback generator provided by main process (calls Python)
// Fallback generator provided by main process (calls Python)
export function registerImageProtocol(fallbackGenerator?: (path: string, width?: number, box?: string, orientation?: number) => Promise<Buffer | null>) {
    protocol.handle('local-resource', async (request) => {
        let decodedPath = '';
        try {
            // DEBUG: Log every request
            // logger.info(`[Protocol] Incoming: ${request.url}`);

            // Parse query params safely
            const urlObj = new URL(request.url);

            // 1. Strip protocol
            // const rawPath = request.url.replace(/^local-resource:\/\//, ''); // URL obj handles this? No, custom protocol.
            // request.url is full string.
            // Note: new URL(request.url) works if protocol is standard-ish, but local-resource might parse nicely.
            // But existing logic did manual stripping. Let's keep existing logic to be safe, or rely on urlObj.pathname?
            // Existing logic:
            const rawPath = request.url.replace(/^local-resource:\/\//, '');

            // 2. Decode the path
            decodedPath = decodeURIComponent(rawPath);

            // 3. Strip query string (manually, as regex replacement might be fragile with paths containing ?)
            const queryIndex = decodedPath.indexOf('?');
            if (queryIndex !== -1) {
                decodedPath = decodedPath.substring(0, queryIndex);
            }

            // 4. Strip trailing slash
            if (decodedPath.endsWith('/') || decodedPath.endsWith('\\')) {
                decodedPath = decodedPath.slice(0, -1);
            }

            // Resize/Crop if requested
            const width = urlObj.searchParams.get('width') ? parseInt(urlObj.searchParams.get('width')!) : null;
            const boxParam = urlObj.searchParams.get('box');

            if ((width && width > 0) || boxParam) {
                try {
                    // Initialize pipeline WITHOUT auto-rotate first
                    let pipeline = sharp(decodedPath);

                    // Fetch DB Orientation (Source of Truth)
                    let dbOrientation = 1;
                    try {
                        const db = getDB();
                        const row = db.prepare('SELECT metadata_json FROM photos WHERE file_path = ?').get(decodedPath) as { metadata_json: string };
                        if (row && row.metadata_json) {
                            const meta = JSON.parse(row.metadata_json);
                            if (meta.Orientation) dbOrientation = parseInt(meta.Orientation);
                            else if (meta.ExifImageOrientation) dbOrientation = parseInt(meta.ExifImageOrientation);
                        }
                    } catch (dbErr) { /* ignore */ }

                    // Check INPUT metadata
                    const inputMeta = await pipeline.metadata();
                    const inputW = inputMeta.width || 0;
                    const inputH = inputMeta.height || 0;
                    const inputOri = inputMeta.orientation || 1;

                    const isInputLandscape = inputW > inputH;
                    const expectsPortrait = (dbOrientation === 6 || dbOrientation === 8);

                    // LOGIC:
                    // 1. If Image is Landscape AND we expect Portrait:
                    //    - Check if Exif exists (inputOri > 1). If so, .rotate() should fix it.
                    //    - If Exif missing, manual rotate based on DB.
                    // 2. If Image is ALREADY Portrait AND we expect Portrait:
                    //    - DO NOT ROTATE. (Avoid double-rotation if Exif is present but file is already upright).

                    // Track if we swapped dimensions
                    let dimsSwapped = false;

                    if (expectsPortrait && isInputLandscape) {
                        // Needs Rotation
                        if (inputOri >= 5 && inputOri <= 8) {
                            // Exif present and valid, trust Auto-Rotate
                            pipeline = pipeline.rotate();
                            // Auto-rotate from Landscape(Sensor) to Portrait(Visual) ALWAYS swaps dimensions
                            dimsSwapped = true;
                        } else {
                            // Exif missing/invalid, Manual Rotate
                            if (dbOrientation === 6) { pipeline = pipeline.rotate(90); dimsSwapped = true; }
                            else if (dbOrientation === 8) { pipeline = pipeline.rotate(-90); dimsSwapped = true; }
                        }
                    } else if (dbOrientation === 3) {
                        // 180 handling - No Dim Swap
                        if (inputOri === 3) pipeline = pipeline.rotate();
                        else pipeline = pipeline.rotate(180);
                    }
                    // Else: Already matches, or Landscape expected. Do nothing.

                    // logger.info(`[ImageProtocol] Rotation Logic for ${path.basename(decodedPath)}: DB=${dbOrientation}, In=${inputW}x${inputH} (Ori=${inputOri}) -> Action: ${expectsPortrait && isInputLandscape ? 'ROTATE' : 'KEEP'}, Swapped=${dimsSwapped}`);

                    // 1. Crop if requested (x,y,w,h)
                    if (boxParam) {
                        const [x, y, w, h] = boxParam.split(',').map(Number);
                        if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) {
                            // Validate/Clamp against image dimensions to prevent "extract_area" errors
                            const metadata = await pipeline.metadata();

                            // Correct dimensions if swapped
                            let currentW = metadata.width || 0;
                            let currentH = metadata.height || 0;

                            if (dimsSwapped) {
                                [currentW, currentH] = [currentH, currentW];
                            }

                            if (currentW && currentH) {
                                let finalX = x;
                                let finalY = y;
                                let finalW = w;
                                let finalH = h;

                                // Checking for originalWidth to perform checking
                                const originalWidth = urlObj.searchParams.get('originalWidth') ? parseInt(urlObj.searchParams.get('originalWidth')!) : null;

                                if (originalWidth && originalWidth > 0 && currentW !== originalWidth) {
                                    const scale = currentW / originalWidth;
                                    finalX = x * scale;
                                    finalY = y * scale;
                                    finalW = w * scale;
                                    finalH = h * scale;
                                }

                                const safeX = Math.max(0, Math.min(Math.round(finalX), currentW - 1));
                                const safeY = Math.max(0, Math.min(Math.round(finalY), currentH - 1));
                                const safeW = Math.max(1, Math.min(Math.round(finalW), currentW - safeX));
                                const safeH = Math.max(1, Math.min(Math.round(finalH), currentH - safeY));

                                pipeline = pipeline.extract({ left: safeX, top: safeY, width: safeW, height: safeH });
                            }
                        }
                    }

                    // 2. Resize if width provided
                    if (width && width > 0) {
                        pipeline = pipeline.resize(width, null, { fit: 'inside', withoutEnlargement: true });
                    }

                    const buffer = await pipeline.toBuffer();

                    return new Response(buffer as any, {
                        headers: {
                            'Content-Type': 'image/jpeg',
                            'Cache-Control': 'max-age=3600'
                        }
                    });
                } catch (resizeErr: any) {
                    const errMessage = resizeErr.message || String(resizeErr);
                    // logger.warn(`[Protocol] Transform failed for ${decodedPath}: ${errMessage}`);

                    // ATTEMPT FALLBACK TO GENERATED PREVIEW (Crucial for RAW files)
                    try {
                        const db = getDB();
                        const row = db.prepare('SELECT preview_cache_path FROM photos WHERE file_path = ?').get(decodedPath) as { preview_cache_path: string };

                        if (row && row.preview_cache_path) {
                            // Check HQ override
                            const isHQ = urlObj.searchParams.get('hq') === 'true';

                            // Only use preview if NOT HQ
                            if (!isHQ) {
                                // logger.info(`[Protocol] Using Fallback Preview for ${decodedPath} -> ${row.preview_cache_path}`);
                                // Verify preview file exists
                                await fs.access(row.preview_cache_path);

                                // Serve the preview using sharp (to respect resize options if possible, or just raw)
                                // Ideally, treat the preview as the new source and re-apply transform.
                                // But careful about infinite loops if preview itself fails.

                                // Simple: Just serve existing preview if no box/width, or try to resize preview.
                                let previewPipeline = sharp(row.preview_cache_path).rotate(); // Previews are JPEGs, safe for sharp

                                // Re-apply box/resize if needed on the preview?
                                // Logic: The preview is FULL IMAGE (just converted). 
                                // So x,y,w,h from original *should* map if preview matches aspect ratio.
                                // Python side matches cached preview dimensions to original aspect ratio usually.

                                if (boxParam) {
                                    const pMeta = await previewPipeline.metadata();
                                    const boxParts = boxParam.split(',').map(Number);

                                    // We need to know if preview coords match original coords relative to size.
                                    // If preview is smaller, we must scale the box.

                                    const originalWidth = urlObj.searchParams.get('originalWidth') ? parseInt(urlObj.searchParams.get('originalWidth')!) : null;
                                    let scale = 1;

                                    if (originalWidth && pMeta.width) {
                                        scale = pMeta.width / originalWidth;
                                        if (originalWidth !== pMeta.width) {
                                            logger.info(`[ImageProtocol] Scaling Box for ${path.basename(decodedPath)}. Original: ${originalWidth}, Current: ${pMeta.width}. Scale: ${scale}`);
                                        }
                                        logger.debug(`[Protocol] RAW Preview Scale for ${decodedPath}: Width=${pMeta.width}, Original=${originalWidth}, Scale=${scale}`);
                                    } else if (!originalWidth && pMeta.width) {
                                        logger.warn(`[Protocol] RAW Preview missing 'originalWidth' param for ${decodedPath}. Cannot scale crop box.`);
                                    }

                                    const [x, y, w, h] = boxParts;
                                    const nx = Math.round(x * scale);
                                    const ny = Math.round(y * scale);
                                    const nw = Math.round(w * scale);
                                    const nh = Math.round(h * scale);

                                    previewPipeline = previewPipeline.extract({
                                        left: Math.max(0, nx),
                                        top: Math.max(0, ny),
                                        width: Math.min(nw, pMeta.width! - nx),
                                        height: Math.min(nh, pMeta.height! - ny)
                                    });
                                }

                                if (width && width > 0) {
                                    previewPipeline = previewPipeline.resize(width, null, { fit: 'inside', withoutEnlargement: true });
                                }

                                const pBuffer = await previewPipeline.toBuffer();
                                return new Response(pBuffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                            } // End !isHQ check
                        }
                    } catch (fbErr) {
                        // Fallback failed, log original error to DB
                        logger.warn(`[Protocol] Preview fallback failed for ${decodedPath}: ${fbErr}`);
                    }

                    // RECOVERY STRATEGY: If this was a preview file that failed (corrupt?), try to find original source
                    const match = decodedPath.match(/previews[\\\/]([a-f0-9]+)\.jpg/);
                    if (match && match[1]) {
                        try {
                            const db = getDB();
                            const row = db.prepare('SELECT file_path FROM photos WHERE preview_cache_path LIKE ?').get(`%${match[1]}%`) as { file_path: string };
                            if (row && row.file_path) {
                                const srcPath = row.file_path;
                                // logger.info(`[Protocol] Inner Recovery: Preview corrupt, falling back to original: ${srcPath}`);

                                // Recurse? No, explicit fallback logic for original
                                const srcExt = path.extname(srcPath).toLowerCase();
                                const isSrcRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(srcExt);

                                if (isSrcRaw && fallbackGenerator) {
                                    // For RAW, use Python. 
                                    const fbWidth = width || 300;
                                    // Pass box if available
                                    const fbBuffer = await fallbackGenerator(srcPath, fbWidth, boxParam ? boxParam : undefined);
                                    if (fbBuffer) {
                                        return new Response(fbBuffer as any, { headers: { 'Content-Type': 'image/jpeg', 'X-Generated-By': 'Python-Recover-RAW' } });
                                    }
                                } else {
                                    // For non-RAW, use Sharp or Net fetch
                                    // If box provided, use Sharp on original
                                    if (boxParam) {
                                        // Re-run sharp pipeline on ORIGINAL
                                        // logger.info(`[Protocol] Re-trying crop on original: ${srcPath}`);
                                        let pipeline = sharp(srcPath).rotate();

                                        const [x, y, w, h] = boxParam.split(',').map(Number);
                                        if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) {
                                            pipeline = pipeline.extract({ left: x, top: y, width: w, height: h });
                                        }
                                        if (width) {
                                            pipeline = pipeline.resize(width, width, { fit: 'cover' }); // Thumbnail crops are usually square
                                        }

                                        const buffer = await pipeline.toBuffer();
                                        return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                                    } else {
                                        return await net.fetch(pathToFileURL(srcPath).toString());
                                    }
                                }
                            }
                        } catch (recErr) {
                            logger.warn(`[Protocol] Inner Recovery failed: ${recErr}`);
                        }
                    }


                    // Try Python Fallback (mainly for RAW files that Sharp cannot handle)
                    // This runs if decodedPath is the RAW file itself and sharp failed
                    if (fallbackGenerator) {
                        try {
                            // If it's a RAW file request (no preview in path)
                            const ext = path.extname(decodedPath).toLowerCase();
                            const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

                            if (isRaw || boxParam || !boxParam) { // ALWAYS try Python fallback if Sharp failed, especially for RAW or complex crops
                                const fbWidth = width || 300;

                                // Fetch Orientation from DB to help Python rotate correctly
                                let orientation = 1;
                                try {
                                    const db = getDB();
                                    const row = db.prepare('SELECT metadata_json FROM photos WHERE file_path = ?').get(decodedPath) as { metadata_json: string };
                                    if (row && row.metadata_json) {
                                        const meta = JSON.parse(row.metadata_json);
                                        // Standard Exif Tags for Orientation
                                        if (meta.Orientation) orientation = parseInt(meta.Orientation);
                                        else if (meta.ExifImageOrientation) orientation = parseInt(meta.ExifImageOrientation);
                                    }
                                } catch (dbErr) { /* ignore */ }

                                // logger.debug(`[Protocol] Attempting Python Fallback with Orient=${orientation} for ${decodedPath}`);
                                const fbBuffer = await fallbackGenerator(decodedPath, fbWidth, boxParam ? boxParam : undefined, orientation);
                                if (fbBuffer) {
                                    return new Response(fbBuffer as any, {
                                        headers: {
                                            'Content-Type': 'image/jpeg',
                                            'X-Generated-By': 'Python-Fallback'
                                        }
                                    });
                                }
                            }
                        } catch (pyErr) {
                            logger.warn(`[Protocol] Python Fallback (Resize) failed: ${pyErr}`);
                        }
                    }

                    // Check for silent 404
                    const isSilent404 = request.url.includes('silent_404=true');
                    if (isSilent404) {
                        return new Response(TRANSPARENT_1X1_PNG, {
                            status: 200,
                            headers: {
                                'Content-Type': 'image/png',
                                'Cache-Control': 'no-cache'
                            }
                        });
                    }

                    // Log to scan_errors for user visibility
                    if (!isSilent404) {
                        try {
                            const db = getDB();
                            const photoParam = urlObj.searchParams.get('photoId');
                            let photoId = photoParam ? parseInt(photoParam) : null;

                            if (!photoId) {
                                const row = db.prepare('SELECT id FROM photos WHERE file_path = ?').get(decodedPath) as { id: number };
                                if (row) photoId = row.id;
                            }

                            if (photoId) {
                                db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)').run(photoId, decodedPath, errMessage, 'Preview Generation');
                            }
                        } catch (dbErr) {
                            logger.error("[Protocol] Failed to log error to DB", dbErr);
                        }
                    }

                    return new Response('Thumbnail Generation Failed', { status: 500 });
                }
            }


            // Direct file access (no resize)
            // Fix for RAW files: Browser cannot render RAW bytes. We MUST convert or use preview.
            const ext = path.extname(decodedPath).toLowerCase();
            const isRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);

            if (isRaw) {
                try {
                    // 1. Try to find a preview in the DB
                    const db = getDB();
                    const row = db.prepare('SELECT preview_cache_path FROM photos WHERE file_path = ?').get(decodedPath) as { preview_cache_path: string };

                    if (row && row.preview_cache_path) {
                        try {
                            await fs.access(row.preview_cache_path);
                            // Serve the preview
                            const prevBuffer = await fs.readFile(row.preview_cache_path);
                            return new Response(prevBuffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                        } catch (e) {
                            logger.warn(`[Protocol] RAW Preview found but inaccessible: ${row.preview_cache_path}`);
                        }
                    }

                    // 2. Fallback: Convert RAW on the fly (Slow but valid)
                    // logger.info(`[Protocol] Converting RAW on-the-fly: ${decodedPath}`);
                    const buffer = await sharp(decodedPath)
                        .rotate()
                        .toFormat('jpeg', { quality: 80 })
                        .toBuffer();
                    // logger.info(`[Protocol] RAW Conversion done (${Date.now() - startRaw}ms): ${decodedPath}`);

                    return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });

                } catch (rawErr) {
                    logger.error(`[Protocol] Failed to serve RAW file ${decodedPath}:`, rawErr);
                    // Let it fall through to outer catch (which handles silent_404)
                    throw rawErr;
                }
            }

            // Standard Format Handling
            try {
                // Verify existence first (optional but good for triggering recovery on fail)
                await fs.access(decodedPath);

                // logger.info(`[Protocol] Sourcing file via net.fetch: ${decodedPath}`);
                const response = await net.fetch(pathToFileURL(decodedPath).toString());
                // logger.info(`[Protocol] Response Headers for ${decodedPath}: Status=${response.status}, Content-Type=${response.headers.get('content-type')}, Content-Length=${response.headers.get('content-length')}`);
                return response;

            } catch (fsErr) {
                // logger.warn(`[Protocol] fs.access failed for ${decodedPath}`);
                throw fsErr; // Throw to trigger fallback logging in outer catch
            }
        } catch (e: any) {
            const msg = e.message || String(e);

            // RECOVERY: If file is missing, check if it's a known preview and try to serve original
            if (msg.includes('ERR_FILE_NOT_FOUND') || msg.includes('ENOENT')) {
                try {
                    // Regex to detect preview path format: .../previews/[hash].jpg
                    const match = decodedPath.match(/previews[\\\/]([a-f0-9]+)\.jpg/);
                    if (match && match[1]) {
                        const db = getDB();
                        // Find the original file that owns this preview
                        const row = db.prepare('SELECT file_path FROM photos WHERE preview_cache_path LIKE ?').get(`%${match[1]}%`) as { file_path: string };

                        if (row && row.file_path) {
                            const srcPath = row.file_path;
                            // logger.info(`[Protocol] Recovery: Preview missing, attempting to serve original: ${srcPath}`);

                            // Serve Original (Reuse logic? A bit complex to recurse. Inline simple logic)
                            // Serve Original
                            const srcExt = path.extname(srcPath).toLowerCase();
                            const isSrcRaw = ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(srcExt);

                            // logger.info(`[Protocol] Recovery Strategy: ${isSrcRaw ? 'Convert RAW' : 'Serve Direct'} for ${srcPath}`);

                            if (isSrcRaw) {
                                try {
                                    // Convert RAW
                                    const buffer = await sharp(srcPath)
                                        .rotate()
                                        .toFormat('jpeg', { quality: 80 })
                                        .toBuffer();
                                    return new Response(buffer as any, { headers: { 'Content-Type': 'image/jpeg' } });
                                } catch (rawErr) {
                                    // logger.warn(`[Protocol] RAW Recovery failed: ${rawErr}. Looking for sibling JPEG...`);
                                    // Attempt to find a sibling JPG
                                    const jpgSiblings = [
                                        srcPath.replace(/\.[^.]+$/, '.JPG'),
                                        srcPath.replace(/\.[^.]+$/, '.jpg'),
                                        srcPath + '.JPG', // e.g. DSC.ARW.JPG
                                        srcPath + '.jpg'
                                    ];

                                    for (const sib of jpgSiblings) {
                                        if (sib === srcPath) continue;
                                        try {
                                            await fs.access(sib);
                                            // logger.info(`[Protocol] Sibling JPEG found: ${sib}`);
                                            return await net.fetch(pathToFileURL(sib).toString());
                                        } catch { /* ignore */ }
                                    }

                                    // NEW: Python Fallback (If provided)
                                    if (fallbackGenerator) {
                                        try {
                                            // logger.info(`[Protocol] Sibling failed. Requesting on-the-fly generation for ${srcPath}`);
                                            // Extract width from original request or default to 300
                                            const fallbackUrlObj = new URL(request.url);
                                            const width = fallbackUrlObj.searchParams.get('width') ? parseInt(fallbackUrlObj.searchParams.get('width')!) : 300;
                                            const fallBuf = await fallbackGenerator(srcPath, width);
                                            if (fallBuf) {
                                                return new Response(fallBuf as any, {
                                                    headers: {
                                                        'Content-Type': 'image/jpeg',
                                                        'X-Generated-By': 'Python-Fallback'
                                                    }
                                                });
                                            }
                                        } catch (pyErr) {
                                            logger.warn(`[Protocol] Python Fallback failed: ${pyErr}`);
                                        }
                                    }

                                    throw rawErr;
                                }
                            } else {
                                // Serve File Direct via net.fetch (Avoids sharp "unsupported format" issues)
                                return await net.fetch(pathToFileURL(srcPath).toString());
                            }
                        }
                    }
                } catch (recoveryErr) {
                    logger.warn(`[Protocol] Recovery failed: ${recoveryErr}`);
                }
            }

            // Check for silent 404 request (from FaceThumbnail)
            const isSilent404 = request.url.includes('silent_404=true');

            // Suppress noisy logs for expected missing files (fallback handles this)
            if (msg.includes('ERR_FILE_NOT_FOUND') || msg.includes('ENOENT')) {
                if (isSilent404) {
                    // logger.info(`[Protocol] Silent fallback served (1x1 PNG): ${decodedPath}`);
                    return new Response(TRANSPARENT_1X1_PNG, {
                        status: 200,
                        headers: {
                            'Content-Type': 'image/png',
                            'Cache-Control': 'no-cache'
                        }
                    });
                }

                // logger.info(`[Protocol] File missing: ${decodedPath}`);
            } else {
                logger.error(`[Protocol] Failed to handle request: ${request.url}`, e);
            }
            return new Response('Not Found', { status: 404 });
        }
    });
}
