import { Sharp } from 'sharp';

export interface ImageMetadata {
    width: number;
    height: number;
    orientation: number;
}

export interface ProcessingOptions {
    width?: number; // Resize width
    box?: { x: number, y: number, w: number, h: number }; // Crop box
    originalWidth?: number; // For scaling crop box relative to original
    hq?: boolean; // Force High Quality (skip preview)
    silent_404?: boolean; // Return transparent pixel on 404
    photoId?: number; // For logging
}

export interface IMetadataRepository {
    getImageMetadata(filePath: string): Promise<{ orientation: number }>;
    getPreviewPath(filePath: string): Promise<string | null>;
    getFilePathFromPreview(previewPathSubstr: string): Promise<string | null>;
    getPhotoId(filePath: string): Promise<number | null>;
    clearPreviewPath(filePath: string): Promise<void>;
    logError(photoId: number, filePath: string, errorMessage: string, stage: string): Promise<void>;
}

export interface IImageProcessor {
    // Process an image from path (apply rotation, crop, resize)
    process(filePath: string, options: ProcessingOptions, dbOrientation?: number): Promise<Buffer>;
    // Process an image from an existing Buffer or Sharp instance (logic re-use)
    processPipeline(pipeline: Sharp, options: ProcessingOptions, dbOrientation?: number, isPreview?: boolean): Promise<Buffer>;
    // Simple convert for RAW
    convertRaw(filePath: string): Promise<Buffer>;
}

export type FallbackGenerator = (path: string, width?: number, box?: string, orientation?: number) => Promise<Buffer | null>;
