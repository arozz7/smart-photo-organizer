import sharp, { Sharp } from 'sharp';
import { IImageProcessor, ProcessingOptions } from './interfaces';

export class SharpImageProcessor implements IImageProcessor {

    async process(filePath: string, options: ProcessingOptions, dbOrientation: number = 1): Promise<Buffer> {
        const pipeline = sharp(filePath);
        return this.processPipeline(pipeline, options, dbOrientation, false);
    }

    async processPipeline(pipeline: Sharp, options: ProcessingOptions, dbOrientation: number = 1, _isPreview: boolean = false): Promise<Buffer> {
        // 1. Handle Metadata & Rotation
        // We need input metadata to decide on rotation
        const inputMeta = await pipeline.metadata();
        const inputW = inputMeta.width || 0;
        const inputH = inputMeta.height || 0;
        const inputOri = inputMeta.orientation || 1;

        const isInputLandscape = inputW > inputH;
        // Expect Portrait if DB says 6 (Rotate 90 CW) or 8 (Rotate 90 CCW / 270 CW)
        const expectsPortrait = (dbOrientation === 6 || dbOrientation === 8);

        let dimsSwapped = false;

        // Rotation Logic (Copied from imageProtocol.ts)
        if (expectsPortrait && isInputLandscape) {
            // Needs Rotation
            if (inputOri >= 5 && inputOri <= 8) {
                // Exif present and valid, trust Auto-Rotate
                pipeline.rotate();
                // Auto-rotate from Landscape(Sensor) to Portrait(Visual) ALWAYS swaps dimensions
                dimsSwapped = true;
            } else {
                // Exif missing/invalid, Manual Rotate
                if (dbOrientation === 6) { pipeline.rotate(90); dimsSwapped = true; }
                else if (dbOrientation === 8) { pipeline.rotate(-90); dimsSwapped = true; }
            }
        } else if (dbOrientation === 3) {
            // 180 handling - No Dim Swap
            if (inputOri === 3) pipeline.rotate();
            else pipeline.rotate(180);
        }
        // Else: Already matches, or Landscape expected. Do nothing.

        // 2. Crop (Box)
        if (options.box) {
            // Need current dimensions after potential swap
            let currentW = inputW;
            let currentH = inputH;

            if (dimsSwapped) {
                [currentW, currentH] = [currentH, currentW];
            }

            if (currentW && currentH) {
                let { x, y, w, h } = options.box;

                // Scaling Logic
                if (options.originalWidth && options.originalWidth > 0 && currentW !== options.originalWidth) {
                    const scale = currentW / options.originalWidth;
                    x = x * scale;
                    y = y * scale;
                    w = w * scale;
                    h = h * scale;
                }

                const safeX = Math.max(0, Math.min(Math.round(x), currentW - 1));
                const safeY = Math.max(0, Math.min(Math.round(y), currentH - 1));
                const safeW = Math.max(1, Math.min(Math.round(w), currentW - safeX));
                const safeH = Math.max(1, Math.min(Math.round(h), currentH - safeY));

                pipeline.extract({ left: safeX, top: safeY, width: safeW, height: safeH });
            }
        }

        // 3. Resize
        if (options.width && options.width > 0) {
            pipeline.resize(options.width, null, { fit: 'inside', withoutEnlargement: true });
        }

        return await pipeline.toBuffer();
    }

    async convertRaw(filePath: string): Promise<Buffer> {
        return await sharp(filePath)
            .rotate()
            .toFormat('jpeg', { quality: 80 })
            .toBuffer();
    }
}
