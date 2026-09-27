import { statSync } from 'node:fs';
import path from 'node:path';
import logger from '../logger';
import { PhotoService } from '../core/services/PhotoService';
import { isRawLikeExtension, isSupportedImageExtension } from '../utils/imageFormats';
import { computeSHA256, isPreviewUsable } from './fileHelpers';
import { compareIdentity, readFileIdentity, type FileIdentity } from './fileIdentity';
import { extractDimensions, resolveDateTaken, type ExifTags } from './imageMetadata';
import type { PhotoRow, ScanStatements } from './ScanStatements';

export interface ProcessOptions {
    forceRescan?: boolean;
}

/**
 * A `photos` row plus the flags the scan queue and UI use.
 * `contentChanged` means the file was edited outside the app since it was indexed: the UI then queues a
 * clean re-analysis (faces are re-detected and named people are re-matched).
 */
export type ScannedPhoto = PhotoRow & { isNew: boolean; needsUpdate: boolean; contentChanged: boolean };

const errorMessage = (error: unknown): string => (error instanceof Error && error.message) || String(error);

/** Reads full metadata. Null means "unavailable" (no ExifTool, or the read failed). */
async function readMetadata(fullPath: string): Promise<ExifTags | null> {
    try {
        const tool = await PhotoService.getExifTool();
        if (!tool) return null;
        return (await tool.read(fullPath)) as ExifTags;
    } catch (e) {
        logger.error(`Failed to read metadata for ${fullPath}`, e);
        return null;
    }
}

/** Regenerates a missing/forced preview for a known photo. Returns true if a preview was written. */
async function regeneratePreview(photo: PhotoRow, fullPath: string, previewDir: string, stmts: ScanStatements, force: boolean): Promise<boolean> {
    // RAW-like previews need ExifTool; without it we leave the photo as it is.
    if (isRawLikeExtension(path.extname(fullPath)) && !(await PhotoService.getExifTool())) return false;

    try {
        const previewPath = await PhotoService.extractPreview(fullPath, previewDir, force, true);
        if (!previewPath) return false;

        stmts.updatePreview(photo.id, previewPath);
        photo.preview_cache_path = previewPath;
        stmts.clearErrors(photo.id);
        return true;
    } catch (e) {
        logger.error(`[Scanner] Preview generation failed for ${path.basename(fullPath)}`, e);
        stmts.addError(photo.id, fullPath, errorMessage(e), 'Preview Generation');
        return false;
    }
}

/** Fills in missing metadata/dimensions for a known photo. Returns true if it was updated. */
async function backfillMetadata(photo: PhotoRow, fullPath: string, stmts: ScanStatements): Promise<boolean> {
    try {
        const tool = await PhotoService.getExifTool();
        if (!tool) return false;

        const metadata = (await tool.read(fullPath)) as ExifTags;
        const { width, height } = extractDimensions(metadata);
        const json = JSON.stringify(metadata);

        stmts.updateMetadata(photo.id, json, width, height);
        photo.metadata_json = json;
        photo.width = width;
        photo.height = height;
        return true;
    } catch (e) {
        logger.error(`Failed to backfill metadata for ${fullPath}`, e);
        return false;
    }
}

interface ChangeCheck {
    /** True only when the content really differs from what was indexed. */
    contentChanged: boolean;
    /** Hash of the current content, when it was computed for the check. */
    sha256: string | null;
    /** True when the recorded size/time should be brought up to date (filled in, or a harmless timestamp change). */
    refreshIdentity: boolean;
}

/**
 * Decides whether a known photo was edited outside the app. Cheap first (size and time); the content hash is
 * only computed when the size matches but the time moved, to tell "touched/copied" (same bytes) from "edited".
 * Being wrong towards "edited" triggers a face re-scan, so when there is no stored hash to compare against we
 * assume "not edited" rather than guess.
 */
async function checkForContentChange(photo: PhotoRow, fullPath: string, current: FileIdentity): Promise<ChangeCheck> {
    const verdict = compareIdentity({ size: photo.file_size, mtime: photo.file_mtime }, current);

    switch (verdict) {
        case 'unchanged':
            return { contentChanged: false, sha256: null, refreshIdentity: false };
        case 'identity-missing':
            return { contentChanged: false, sha256: null, refreshIdentity: true };
        case 'changed':
            return { contentChanged: true, sha256: await computeSHA256(fullPath), refreshIdentity: true };
        case 'needs-hash-check': {
            const sha256 = await computeSHA256(fullPath);
            const edited = sha256 !== null && photo.sha256_hash !== null && sha256 !== photo.sha256_hash;
            return { contentChanged: edited, sha256, refreshIdentity: true };
        }
    }
}

async function refreshKnownPhoto(photo: PhotoRow, fullPath: string, previewDir: string, stmts: ScanStatements, force: boolean): Promise<ScannedPhoto> {
    const current = await readFileIdentity(fullPath);
    const change: ChangeCheck = current
        ? await checkForContentChange(photo, fullPath, current)
        : { contentChanged: false, sha256: null, refreshIdentity: false };

    // An edited file is reprocessed like a forced rescan: new preview and metadata, then AI re-analysis.
    const redo = force || change.contentChanged;
    let needsUpdate = redo;

    if (redo || !(await isPreviewUsable(photo.preview_cache_path))) {
        if (await regeneratePreview(photo, fullPath, previewDir, stmts, redo)) needsUpdate = true;
    }

    if (redo || !photo.metadata_json || photo.metadata_json === '{}') {
        if (await backfillMetadata(photo, fullPath, stmts)) needsUpdate = true;
    }

    // Recorded even if the preview failed: otherwise a file that keeps failing would be re-analysed on every scan
    // (the failure is visible in the scan errors).
    if (current) {
        if (change.contentChanged) stmts.recordContentChange(photo.id, change.sha256, current);
        else if (change.refreshIdentity || force) stmts.updateIdentity(photo.id, current);
    }

    return Object.assign(photo, { isNew: redo, needsUpdate, contentChanged: change.contentChanged });
}

async function ingestNewPhoto(fullPath: string, previewDir: string, stmts: ScanStatements, force: boolean): Promise<ScannedPhoto | null> {
    logger.debug(`[Scanner] New photo found: ${path.basename(fullPath)}`);

    // Identity before any content is read: if the file changes while it is being processed, the next scan sees a mismatch.
    const identity = await readFileIdentity(fullPath);

    // Read metadata first: its Orientation lets preview generation skip a second ExifTool call.
    const metadata = await readMetadata(fullPath);

    let previewPath: string | null = null;
    let previewFailure: string | null = null;
    try {
        previewPath = await PhotoService.extractPreview(fullPath, previewDir, force, true, metadata ? { Orientation: metadata.Orientation } : undefined);
    } catch (e) {
        // Keep going: the photo is still inserted so the error can be recorded against it.
        previewFailure = errorMessage(e);
        logger.error(`[Scanner] Initial preview failed for ${path.basename(fullPath)}`, e);
    }

    try {
        const tags = metadata ?? {};
        const { width, height } = extractDimensions(tags);
        const dateTaken = resolveDateTaken(tags, { birthtime: () => statSync(fullPath).birthtime, now: () => new Date() });

        stmts.addNewPhoto({
            file_path: fullPath,
            preview_cache_path: previewPath,
            created_at: new Date().toISOString(),
            date_taken: dateTaken,
            metadata_json: JSON.stringify(tags),
            width,
            height,
            sha256_hash: await computeSHA256(fullPath),
            file_size: identity?.size ?? null,
            file_mtime: identity?.mtime ?? null,
            file_id: identity?.fileId ?? null,
        }, previewFailure);

        const photo = stmts.findByPath(fullPath);
        return photo ? Object.assign(photo, { isNew: true, needsUpdate: false, contentChanged: false }) : null;
    } catch (e) {
        logger.error('Insert failed', e);
        return null;
    }
}

/** Indexes one file: inserts it if new, otherwise repairs its preview/metadata. Null if unsupported or not stored. */
export async function processFile(fullPath: string, previewDir: string, stmts: ScanStatements, options: ProcessOptions = {}): Promise<ScannedPhoto | null> {
    if (!isSupportedImageExtension(path.extname(fullPath))) return null;

    const force = Boolean(options.forceRescan);
    const known = stmts.findByPath(fullPath);
    return known
        ? refreshKnownPhoto(known, fullPath, previewDir, stmts, force)
        : ingestNewPhoto(fullPath, previewDir, stmts, force);
}
