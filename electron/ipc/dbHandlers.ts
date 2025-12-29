import { ipcMain, app } from 'electron';
import { getDB } from '../db';
import { getAISettings } from '../store';
import { scheduleMeanRecalc } from '../utils/dbHelpers';
import logger from '../logger';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export function registerDBHandlers() {
    ipcMain.handle('db:getMetricsHistory', async () => {
        const { getMetricsHistory } = await import('../db');
        return getMetricsHistory();
    });

    ipcMain.handle('db:getScanErrors', async () => {
        const { getScanErrors } = await import('../db');
        return await getScanErrors();
    });

    ipcMain.handle('db:deleteScanError', async (_, { id, deleteFile }) => {
        const { deleteScanErrorAndFile } = await import('../db');
        return await deleteScanErrorAndFile(id, deleteFile);
    });

    ipcMain.handle('db:cleanupTags', async () => {
        const { cleanupTags } = await import('../db');
        return await cleanupTags();
    });

    ipcMain.handle('db:getAllTags', async () => {
        const { getDB } = await import('../db');
        const db = getDB();
        try {
            const stmt = db.prepare('SELECT * FROM tags ORDER BY name ASC');
            return stmt.all();
        } catch (e) {
            console.error('Failed to get tags:', e);
            return [];
        }
    });

    ipcMain.handle('db:getTags', async (_event, photoId: number) => {
        const { getDB } = await import('../db');
        const db = getDB();
        try {
            const stmt = db.prepare(`
                SELECT t.name 
                FROM tags t
                JOIN photo_tags pt ON t.id = pt.tag_id
                WHERE pt.photo_id = ?
            `);
            const rows = stmt.all(photoId);
            return rows.map((r: any) => r.name);
        } catch (e) {
            console.error('Failed to get tags for photo:', e);
            return [];
        }
    });

    ipcMain.handle('db:removeTag', async (_event, { photoId, tag }) => {
        const { getDB } = await import('../db');
        const db = getDB();
        try {
            const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
            const deleteLink = db.prepare('DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?');

            const tagRow = getTagId.get(tag) as { id: number };
            if (tagRow) {
                deleteLink.run(photoId, tagRow.id);
            }
            return { success: true };
        } catch (e) {
            console.error('Failed to remove tag:', e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getPhotos', async (_event, { page = 1, limit = 50, sort = 'date_desc', filter = {}, offset: providedOffset }) => {
        const { getDB } = await import('../db');
        const db = getDB();
        // Use provided offset if available, otherwise calculate from page
        const offset = providedOffset !== undefined ? providedOffset : (page - 1) * limit;
        let orderBy = 'created_at DESC';

        switch (sort) {
            case 'date_asc': orderBy = 'created_at ASC'; break;
            case 'name_asc': orderBy = 'file_path ASC'; break;
            case 'name_desc': orderBy = 'file_path DESC'; break;
        }

        const params: any[] = [];
        const conditions: string[] = [];

        // Apply Filters
        if (filter.folder) {
            conditions.push('file_path LIKE ?');
            params.push(`${filter.folder}%`);
        }
        if (filter.search) {
            conditions.push('file_path LIKE ?');
            params.push(`%${filter.search}%`);
        }
        if (filter.tag) {
            conditions.push('id IN (SELECT photo_id FROM photo_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)');
            params.push(filter.tag);
        }
        if (filter.people && filter.people.length > 0) {
            // Assuming filter.people is [personId]
            const personId = filter.people[0];
            conditions.push('id IN (SELECT photo_id FROM faces WHERE person_id = ?)');
            params.push(personId);
        }
        if (filter.untagged === 'untagged') {
            // "Untagged" usually implies no people or no tags? Or specifically "Review"? 
            // In Library.tsx: value="untagged" -> "Untagged (Review)"
            // Usually this means faces with NO person_id
            conditions.push('id IN (SELECT photo_id FROM faces WHERE person_id IS NULL)');
        }

        let whereClause = '';
        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        try {
            const query = `SELECT * FROM photos${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
            const countQuery = `SELECT COUNT(*) as count FROM photos${whereClause}`;

            const photos = db.prepare(query).all(...params, limit, offset);
            const total = db.prepare(countQuery).get(...params).count;

            return { photos, total };
        } catch (e) {
            console.error('Failed to get photos:', e);
            return { photos: [], total: 0, error: String(e) };
        }
    });

    ipcMain.handle('db:getPhotosMissingBlurScores', async () => {
        const db = getDB();
        try {
            const stmt = db.prepare('SELECT DISTINCT photo_id FROM faces WHERE blur_score IS NULL');
            const rows = stmt.all();
            return { success: true, photoIds: rows.map((r: any) => r.photo_id) };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getPhotosForTargetedScan', async (_event, options?: { folderPath?: string, onlyWithFaces?: boolean }) => {
        const db = getDB();
        let query = `
      SELECT id, file_path FROM photos 
      WHERE id NOT IN (
        SELECT DISTINCT photo_id FROM scan_history 
        WHERE status = 'success' AND scan_mode = 'MACRO'
      )
    `;
        const params: any[] = [];

        if (options?.folderPath) {
            query += ` AND file_path LIKE ?`;
            params.push(`${options.folderPath}%`);
        }

        if (options?.onlyWithFaces) {
            query += ` AND id IN (SELECT DISTINCT photo_id FROM faces)`;
        }

        try {
            const stmt = db.prepare(query);
            return stmt.all(...params);
        } catch (e) {
            return [];
        }
    });

    ipcMain.handle('db:removeDuplicateFaces', async () => {
        const db = getDB();
        try {
            // 1. Get photos with multiple faces
            const photosWithMultipleFaces = db.prepare(`
                SELECT photo_id, COUNT(*) as count 
                FROM faces 
                GROUP BY photo_id 
                HAVING count > 1
            `).all();

            let removedCount = 0;
            const deleteStmt = db.prepare('DELETE FROM faces WHERE id = ?');

            for (const p of photosWithMultipleFaces) {
                const photoId = p.photo_id;
                // Get all faces for this photo
                const faces = db.prepare('SELECT * FROM faces WHERE photo_id = ? ORDER BY id ASC').all(photoId);
                const uniqueFaces: any[] = [];

                for (const face of faces) {
                    const box = JSON.parse(face.box_json);
                    let duplicate = false;

                    for (const unique of uniqueFaces) {
                        const uniqueBox = JSON.parse(unique.box_json);
                        // IoU Calculation
                        const xA = Math.max(box.x, uniqueBox.x);
                        const yA = Math.max(box.y, uniqueBox.y);
                        const xB = Math.min(box.x + box.width, uniqueBox.x + uniqueBox.width);
                        const yB = Math.min(box.y + box.height, uniqueBox.y + uniqueBox.height);
                        const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);

                        if (interArea > 0) {
                            const boxAArea = box.width * box.height;
                            const boxBArea = uniqueBox.width * uniqueBox.height;
                            const iou = interArea / (boxAArea + boxBArea - interArea);
                            if (iou > 0.5) {
                                duplicate = true;
                                break;
                            }
                        }
                    }

                    if (!duplicate) {
                        uniqueFaces.push(face);
                    } else {
                        // Delete this face
                        deleteStmt.run(face.id);
                        removedCount++;
                    }
                }
            }

            console.log(`Deduplication complete. Removed ${removedCount} faces.`);
            return { success: true, removedCount };

        } catch (e) {
            console.error('Failed to remove duplicates:', e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:updateFaces', async (_event, { photoId, faces, globalBlurScore }) => {
        const db = getDB();
        try {
            // Transactional update
            const transaction = db.transaction(() => {
                // 1. Update Photo Blur Score
                if (globalBlurScore !== undefined) {
                    db.prepare('UPDATE photos SET blur_score = ? WHERE id = ?').run(globalBlurScore, photoId);
                }

                // 2. PRESERVE EXISTING ASSIGNMENTS
                // Fetch old faces to map names/ignored status to new results
                const oldFaces = db.prepare('SELECT id, box_json, person_id, is_ignored FROM faces WHERE photo_id = ?').all(photoId);

                // Helper for IoU
                const getIoU = (boxA: any, boxB: any) => {
                    const xA = Math.max(boxA.x, boxB.x);
                    const yA = Math.max(boxA.y, boxB.y);
                    const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
                    const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

                    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
                    const boxAArea = boxA.width * boxA.height;
                    const boxBArea = boxB.width * boxB.height;
                    return interArea / (boxAArea + boxBArea - interArea);
                };

                // 3. Clear existing faces
                db.prepare('DELETE FROM faces WHERE photo_id = ?').run(photoId);

                // 4. Insert new faces (with preserved IDs if matched)
                const insert = db.prepare(`
                    INSERT INTO faces (photo_id, box_json, descriptor, score, blur_score, person_id, is_ignored) 
                    VALUES (@photo_id, @box_json, @descriptor, @score, @blur_score, @person_id, @is_ignored)
                `);

                for (const face of faces) {
                    let descBuf = null;
                    if (face.descriptor && Array.isArray(face.descriptor)) {
                        descBuf = Buffer.from(new Float32Array(face.descriptor).buffer);
                    }

                    // Attempt to find a matching old face
                    let preservedPersonId = null;
                    let preservedIgnored = 0;

                    for (const old of oldFaces) {
                        try {
                            // @ts-ignore
                            const oldBox = JSON.parse(old.box_json);
                            if (getIoU(oldBox, face.box) > 0.5) {
                                // @ts-ignore
                                preservedPersonId = old.person_id;
                                // @ts-ignore
                                preservedIgnored = old.is_ignored || 0;
                                break;
                            }
                        } catch (e) { /* ignore parse errors */ }
                    }

                    insert.run({
                        photo_id: photoId,
                        box_json: JSON.stringify(face.box),
                        descriptor: descBuf,
                        score: face.score || 0,
                        blur_score: face.blur_score || null,
                        person_id: preservedPersonId, // Restore assignment
                        is_ignored: preservedIgnored
                    });
                }
            });

            transaction();

            // Return new face IDs for vector indexing
            const newFaces = db.prepare('SELECT id FROM faces WHERE photo_id = ?').all(photoId);
            return { success: true, ids: newFaces.map((f: any) => f.id) };

        } catch (e) {
            console.error('db:updateFaces failed', e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:addTags', async (_event, { photoId, tags }) => {
        const db = getDB();
        try {
            const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
            const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
            const linkTag = db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)');

            const transaction = db.transaction(() => {
                for (const tag of tags) {
                    const lower = tag.toLowerCase();
                    insertTag.run(lower);
                    const tagId = getTagId.get(lower) as { id: number };
                    if (tagId) {
                        linkTag.run(photoId, tagId.id, 'auto');
                    }
                }
            });
            transaction();
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getFaces', async (_, photoId: number) => {
        const db = getDB();
        try {
            const stmt = db.prepare(`
        SELECT f.*, p.name as person_name 
        FROM faces f
        LEFT JOIN people p ON f.person_id = p.id
        WHERE f.photo_id = ? AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
      `);
            const faces = stmt.all(photoId);
            return faces.map((f: any) => ({
                ...f,
                box: JSON.parse(f.box_json),
                descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
                is_reference: !!f.is_reference
            }));
        } catch (error) {
            console.error('Failed to get faces:', error);
            return [];
        }
    })

    ipcMain.handle('db:getPeople', async () => {
        const db = getDB();
        try {
            const stmt = db.prepare(`
        WITH BestFaces AS (
          SELECT 
            person_id,
            id as face_id,
            photo_id,
            box_json,
            blur_score,
            ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY blur_score DESC) as rn
          FROM faces 
          WHERE person_id IS NOT NULL
        ),
        PersonCounts AS (
            SELECT person_id, COUNT(*) as face_count 
            FROM faces 
            WHERE person_id IS NOT NULL 
            GROUP BY person_id
        )
        SELECT 
          p.*, 
          COALESCE(pc.face_count, 0) as face_count,
          COALESCE(ph.preview_cache_path, ph.file_path) as cover_path,
          bf.box_json as cover_box,
          ph.width as cover_width,
          ph.height as cover_height
        FROM people p
        LEFT JOIN PersonCounts pc ON p.id = pc.person_id
        LEFT JOIN BestFaces bf ON p.id = bf.person_id AND bf.rn = 1
        LEFT JOIN photos ph ON bf.photo_id = ph.id
        ORDER BY face_count DESC
      `);
            return stmt.all();
        } catch (error) {
            console.error('Failed to get people', error);
            return [];
        }
    })

    ipcMain.handle('db:getAllFaces', async (_, { limit = 100, offset = 0, filter = {}, includeDescriptors = true } = {}) => {
        const db = getDB();
        try {
            let query = `
        SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
        FROM faces f
        JOIN photos p ON f.photo_id = p.id
      `;
            const params: any[] = [];
            const conditions: string[] = [];

            // Filter: Unnamed (no person_id)
            if (filter.unnamed) {
                conditions.push('f.person_id IS NULL');
            }

            // Filter: Specific Person
            if (filter.personId) {
                conditions.push('f.person_id = ?');
                params.push(filter.personId);
            }

            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }

            // Default: Hide ignored faces unless specified (future proofing)
            if (!query.includes('is_ignored')) {
                query += conditions.length > 0 ? ' AND is_ignored = 0' : ' WHERE is_ignored = 0';
            }

            query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const stmt = db.prepare(query);
            const faces = stmt.all(...params);

            if (filter.personId) {
                const rawCount = db.prepare('SELECT count(*) as c FROM faces WHERE person_id = ?').get(filter.personId).c;
                logger.info(`[DB_DIAG] db:getAllFaces for Person ${filter.personId}. Filtered Result: ${faces.length}. Raw Faces Count: ${rawCount}`);
                if (rawCount > faces.length) {
                    logger.warn(`[DB_DIAG] Mismatch! ${rawCount - faces.length} faces exist but were filtered out (likely JOIN failed or is_ignored).`);
                }
            }

            // DIAGNOSTICS (Moved here to ensure it runs on Unnamed Faces page)
            try {
                const rawStats = db.prepare(`
                    SELECT 
                        COUNT(*) as total_raw,
                        SUM(CASE WHEN preview_cache_path IS NOT NULL THEN 1 ELSE 0 END) as with_preview,
                        SUM(CASE WHEN preview_cache_path IS NULL THEN 1 ELSE 0 END) as without_preview
                    FROM photos 
                    WHERE file_path LIKE '%.NEF' OR file_path LIKE '%.ARW' OR file_path LIKE '%.CR2'
                `).get();
                logger.info('[Diagnostics] RAW Photo Stats:', rawStats);
            } catch (e) { logger.error('Diag failed', e); }

            return faces.map((f: any) => ({
                ...f,
                box: JSON.parse(f.box_json),
                // Optimize: Only send descriptors if requested. They are heavy (4KB each)
                descriptor: includeDescriptors && f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
                is_reference: !!f.is_reference
            }));
        } catch (error) {
            console.error('Failed to get all faces:', error);
            return [];
        }
    })

    ipcMain.handle('db:assignPerson', async (_, { faceId, personName }) => {
        const db = getDB();

        // Trim but keep case
        const normalizedName = personName.trim();

        const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
        const getPerson = db.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE');
        const getOldPersonId = db.prepare('SELECT person_id FROM faces WHERE id = ?');
        const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');
        const updatePersonName = db.prepare('UPDATE people SET name = ? WHERE id = ?');

        const transaction = db.transaction(() => {
            // Check old person (if any) to update their mean later
            const oldFace = getOldPersonId.get(faceId) as { person_id: number };
            const oldPersonId = oldFace ? oldFace.person_id : null;

            insertPerson.run(normalizedName);
            const person = getPerson.get(normalizedName) as { id: number };

            // Allow case correction
            updatePersonName.run(normalizedName, person.id);

            updateFace.run(person.id, faceId);



            scheduleMeanRecalc(db, person.id);
            if (oldPersonId) {
                scheduleMeanRecalc(db, oldPersonId);
            }

            return person;
        });

        try {
            const result = transaction();
            return { success: true, person: result };
        } catch (e) {
            console.error('Failed to assign person:', e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:getLibraryStats', async () => {
        const db = getDB();
        const path = await import('node:path');

        try {
            // Register DIRNAME function if not exists (safe to retry)
            try {
                db.function('DIRNAME', (p: string) => path.dirname(p));
                // Also need extension extractor
                db.function('EXTNAME', (p: string) => path.extname(p).toLowerCase());
            } catch (e) {/* ignore */ }

            const totalPhotosObj = db.prepare('SELECT COUNT(*) as count FROM photos').get() as { count: number };
            const totalPhotos = totalPhotosObj.count;

            // File Types
            const fileTypes = db.prepare(`
              SELECT EXTNAME(file_path) as type, COUNT(*) as count 
              FROM photos 
              GROUP BY type 
              ORDER BY count DESC
          `).all();

            // Folders (reuse logic but return list)
            const folders = db.prepare(`
              SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
              FROM photos 
              GROUP BY folder 
              ORDER BY count DESC
          `).all();

            // DIAGNOSTICS FOR RAW PHOTOS
            try {
                const rawStats = db.prepare(`
                    SELECT 
                        COUNT(*) as total_raw,
                        SUM(CASE WHEN preview_cache_path IS NOT NULL THEN 1 ELSE 0 END) as with_preview,
                        SUM(CASE WHEN preview_cache_path IS NULL THEN 1 ELSE 0 END) as without_preview
                    FROM photos 
                    WHERE file_path LIKE '%.NEF' OR file_path LIKE '%.ARW' OR file_path LIKE '%.CR2'
                `).get();
                logger.info('[Diagnostics] RAW Photo Stats:', rawStats);

                // Sample one without preview
                const sampleMissing = db.prepare(`
                    SELECT file_path FROM photos 
                    WHERE (file_path LIKE '%.NEF' OR file_path LIKE '%.ARW' OR file_path LIKE '%.CR2')
                    AND preview_cache_path IS NULL 
                    LIMIT 1
                `).get();
                if (sampleMissing) logger.info('[Diagnostics] Sample RAW missing preview:', sampleMissing);

                // FACE STATS
                const faceStats = db.prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM faces) as total_faces,
                        (SELECT COUNT(*) FROM faces WHERE person_id IS NOT NULL) as assigned_faces,
                        (SELECT COUNT(*) FROM faces WHERE person_id IS NULL) as unassigned_faces,
                        (SELECT COUNT(*) FROM people) as total_people
                 `).get();
                logger.info('[Diagnostics] Face Stats:', faceStats);

            } catch (diagErr) {
                logger.error('[Diagnostics] Failed:', diagErr);
            }

            return { success: true, stats: { totalPhotos, fileTypes, folders } };
        } catch (e) {
            console.error("Failed to get library stats:", e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:deleteFaces', async (_, faceIds: number[]) => {
        const db = getDB();
        try {
            if (!faceIds || faceIds.length === 0) return { success: true };
            const placeholders = faceIds.map(() => '?').join(',');

            const getPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);
            const personsToUpdate = getPersonIds.all(...faceIds).map((p: any) => p.person_id);

            const stmt = db.prepare(`DELETE FROM faces WHERE id IN (${placeholders})`);

            const transaction = db.transaction(() => {
                stmt.run(...faceIds);
                for (const pid of personsToUpdate) {
                    scheduleMeanRecalc(db, pid);
                }
            });
            transaction();
            return { success: true };
        } catch (error) {
            logger.error('Failed to delete faces:', error);
            return { success: false, error };
        }
    })

    ipcMain.handle('db:reassignFaces', async (_, { faceIds, personName }: { faceIds: number[], personName: string }) => {
        const db = getDB();

        // Reuse logic: Find or Create person, then update faces
        const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');

        const getPerson = db.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE');
        const updatePersonName = db.prepare('UPDATE people SET name = ? WHERE id = ?');

        // Check if we need to insert person first
        if (personName) {
            insertPerson.run(personName);
        }
        const person = getPerson.get(personName) as { id: number };

        if (!person) {
            return { success: false, error: 'Target person could not be created' };
        }

        // Allow case correction
        updatePersonName.run(personName, person.id);

        try {
            if (!faceIds || faceIds.length === 0) return { success: true };
            const placeholders = faceIds.map(() => '?').join(',');

            // Get all affected ORIGINAL people
            const getOldPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);
            const oldPersonIds = getOldPersonIds.all(...faceIds).map((p: any) => p.person_id);

            const updateFaces = db.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`);

            const transaction = db.transaction(() => {
                updateFaces.run(person.id, ...faceIds);

                // Recalculate new person mean
                scheduleMeanRecalc(db, person.id);

                // Recalculate old people means
                for (const oldPid of oldPersonIds) {
                    scheduleMeanRecalc(db, oldPid);
                }
            });

            transaction();
            return { success: true, person };
        } catch (e) {
            console.error('Failed to reassign faces:', e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:clearScanErrors', async () => {
        const db = getDB();
        try {
            db.exec('DELETE FROM scan_errors');
            return { success: true };
        } catch (e) {
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:retryScanErrors', async () => {
        // Return list of photos to retry
        const db = getDB();
        try {
            const stmt = db.prepare('SELECT photo_id FROM scan_errors');
            const rows = stmt.all();
            // We also delete them from errors so they can be retried fresh? 
            // Or keep them until success? 
            // Standard pattern: retry, if fail again, it logs again.
            db.exec('DELETE FROM scan_errors');

            // Get full photo objects for these IDs
            if (rows.length === 0) return [];
            const ids = rows.map((r: any) => r.photo_id);
            const placeholders = ids.map(() => '?').join(',');
            const photosStmt = db.prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`);
            return photosStmt.all(...ids);

        } catch (e) {
            console.error('Failed to prepare retry:', e);
            return [];
        }
    })

    ipcMain.handle('db:unassignFaces', async (_, faceIds: number[]) => {
        const db = getDB();
        try {
            if (!faceIds || faceIds.length === 0) return { success: true };
            const placeholders = faceIds.map(() => '?').join(',');

            // 1. Identify affected people
            const affectedPeople = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`).all(...faceIds) as { person_id: number }[];
            const personIds = affectedPeople.map(p => p.person_id);

            logger.info(`[Main] Unassigning ${faceIds.length} faces. Affecting ${personIds.length} people: ${personIds.join(', ')}`);

            // 2. Perform Update in transaction
            const transaction = db.transaction(() => {
                const stmt = db.prepare(`UPDATE faces SET person_id = NULL WHERE id IN (${placeholders})`);
                stmt.run(...faceIds);

                // 3. Recalculate Means
                for (const pid of personIds) {
                    scheduleMeanRecalc(db, pid);
                }
            });

            transaction();
            return { success: true };
        } catch (e) {
            console.error('Failed to unassign faces:', e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:getFacesByIds', async (_, ids: number[]) => {
        try {
            const { getFacesByIds } = await import('../db');
            return getFacesByIds(ids);
        } catch (e) {
            logger.error('Failed to get faces by IDs:', e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getPerson', async (_, personId: number) => {
        const db = getDB();
        try {
            const stmt = db.prepare('SELECT * FROM people WHERE id = ?');
            const person = stmt.get(personId);
            return person || null;
        } catch (e) {
            console.error('Failed to get person:', e);
            return null;
        }
    })

    ipcMain.handle('db:getPersonMeanDescriptor', async (_, personId: number) => {
        const db = getDB();
        try {
            const person = db.prepare('SELECT descriptor_mean_json FROM people WHERE id = ?').get(personId) as { descriptor_mean_json: string };
            if (person?.descriptor_mean_json) {
                return JSON.parse(person.descriptor_mean_json);
            }
            return null;
        } catch (e) {
            console.error('Failed to get person mean descriptor:', e);
            return null;
        }
    });

    ipcMain.handle('db:getPeopleWithDescriptors', async () => {
        const db = getDB();
        try {
            const rows = db.prepare('SELECT id, name, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL').all();
            return rows.map((r: any) => ({
                id: r.id,
                name: r.name,
                descriptor: JSON.parse(r.descriptor_mean_json)
            }));
        } catch (e) {
            console.error('Failed to get people with descriptors:', e);
            return [];
        }
    });

    ipcMain.handle('db:associateMatchedFaces', async (_, { personId, faceIds }: { personId: number, faceIds: number[] }) => {
        const db = getDB();
        try {
            if (!faceIds || faceIds.length === 0) return { success: true };
            const placeholders = faceIds.map(() => '?').join(',');

            // Get old person IDs for mean recalcs
            const getOldPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);
            const oldPersonIds = getOldPersonIds.all(...faceIds).map((p: any) => p.person_id);

            const updateFaces = db.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`);

            const transaction = db.transaction(() => {
                updateFaces.run(personId, ...faceIds);
                scheduleMeanRecalc(db, personId);
                for (const opid of oldPersonIds) {
                    scheduleMeanRecalc(db, opid);
                }
            });
            transaction();
            return { success: true };
        } catch (e) {
            console.error('Failed to associate matched faces:', e);
            return { success: false, error: e };
        }
    });

    ipcMain.handle('db:associateBulkMatchedFaces', async (_, associations: { personId: number, faceId: number }[]) => {
        const db = getDB();
        try {
            if (!associations || associations.length === 0) return { success: true };

            const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');
            const getOldPersonId = db.prepare('SELECT person_id FROM faces WHERE id = ?');

            const transaction = db.transaction(() => {
                const affectedPersonIds = new Set<number>();
                for (const { personId, faceId } of associations) {
                    const oldFace = getOldPersonId.get(faceId) as { person_id: number };
                    if (oldFace?.person_id) {
                        affectedPersonIds.add(oldFace.person_id);
                    }
                    updateFace.run(personId, faceId);
                    affectedPersonIds.add(personId);
                }

                for (const pid of affectedPersonIds) {
                    scheduleMeanRecalc(db, pid);
                }
            });

            transaction();
            return { success: true };
        } catch (e) {
            console.error('Failed bulk association:', e);
            return { success: false, error: e };
        }
    });

    ipcMain.handle('db:getFaceMetadata', async (_, faceIds: number[]) => {
        const db = getDB();
        try {
            if (!faceIds || faceIds.length === 0) return [];
            const placeholders = faceIds.map(() => '?').join(',');
            const stmt = db.prepare(`
        SELECT f.id, f.person_id, p.file_path 
        FROM faces f 
        JOIN photos p ON f.photo_id = p.id 
        WHERE f.id IN (${placeholders})
      `);
            return stmt.all(...faceIds);
        } catch (e) {
            console.error('Failed to get face metadata:', e);
            return [];
        }
    });

    ipcMain.handle('db:getFolders', async () => {
        const { getDB } = await import('../db');
        const path = await import('node:path');
        const db = getDB();

        try {
            db.function('DIRNAME', (p: string) => path.dirname(p));
        } catch (e) {
            // Ignore if already registered
        }

        try {
            // Get unique folder paths
            const stmt = db.prepare(`
        SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
        FROM photos 
        GROUP BY folder 
        ORDER BY count DESC
      `);
            return stmt.all();
        } catch (error) {
            console.error('Failed to get folders:', error);
            return [];
        }
    })
    ipcMain.handle('db:ignoreFace', async (_, faceId) => {
        const db = getDB();
        try {
            // Get person_id before ignoring
            const getFace = db.prepare('SELECT person_id FROM faces WHERE id = ?');
            const face = getFace.get(faceId) as { person_id: number };

            const stmt = db.prepare('UPDATE faces SET is_ignored = 1 WHERE id = ?');

            const transaction = db.transaction(() => {
                stmt.run(faceId);

                if (face && face.person_id) {
                    scheduleMeanRecalc(db, face.person_id);
                }
            });
            transaction();
            return { success: true };
        } catch (e) {
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:ignoreFaces', async (_, faceIds: number[]) => {
        const db = getDB();
        try {
            if (!faceIds || faceIds.length === 0) return { success: true };
            const placeholders = faceIds.map(() => '?').join(',');
            const stmt = db.prepare(`UPDATE faces SET is_ignored = 1 WHERE id IN (${placeholders})`);
            const getPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);

            const personsToUpdate = getPersonIds.all(...faceIds).map((p: any) => p.person_id);

            const transaction = db.transaction(() => {
                stmt.run(...faceIds);

                for (const pid of personsToUpdate) {
                    scheduleMeanRecalc(db, pid);
                }
            });
            transaction();
            return { success: true };
        } catch (e) {
            console.error('Failed to ignore faces:', e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:getIgnoredFaces', async (_, { page = 0, limit = 2000 } = {}) => {
        const db = getDB();
        try {
            // 1. Get Total Count
            const countRes = db.prepare('SELECT count(*) as total FROM faces WHERE is_ignored = 1').get();
            const total = countRes ? countRes.total : 0;

            // 2. Get Paginated Rows
            const offset = page * limit;
            const rows = db.prepare(`
      SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height
      FROM faces f
      JOIN photos p ON f.photo_id = p.id
      WHERE f.is_ignored = 1
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

            const faces = rows.map((f: any) => ({
                ...f,
                box: JSON.parse(f.box_json),
                descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
            }));

            return { faces, total };
        } catch (e) {
            console.error('Failed to get ignored faces:', e);
            return { faces: [], total: 0 };
        }
    });

    ipcMain.handle('db:restoreFaces', async (_, { faceIds, targetPersonId }: { faceIds: number[], targetPersonId?: number }) => {
        const db = getDB();
        try {
            if (!faceIds || faceIds.length === 0) return { success: true };

            const placeholders = faceIds.map(() => '?').join(',');

            const transaction = db.transaction(() => {
                // 1. Un-ignore
                const stmt = db.prepare(`UPDATE faces SET is_ignored = 0 WHERE id IN (${placeholders})`);
                stmt.run(...faceIds);

                // 2. Assign if requested
                if (targetPersonId) {
                    const assignStmt = db.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`);
                    assignStmt.run(targetPersonId, ...faceIds);
                    scheduleMeanRecalc(db, targetPersonId);
                } else {
                    // If we just restored without assignment, we need to recalc for anyone who reclaimed these faces
                    const getPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);
                    const personsToUpdate = getPersonIds.all(...faceIds).map((p: any) => p.person_id);
                    for (const pid of personsToUpdate) {
                        scheduleMeanRecalc(db, pid);
                    }
                }
            });

            transaction();
            return { success: true };
        } catch (e) {
            console.error('Failed to restore faces:', e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:getAllUnassignedFaceDescriptors', async () => {
        const db = getDB();
        try {
            // Get all unassigned and not ignored faces efficiently
            const stmt = db.prepare(`
        SELECT id, descriptor, photo_id 
        FROM faces 
        WHERE person_id IS NULL AND is_ignored = 0
      `);
            const rows = stmt.all();
            return rows.map((r: any) => ({
                id: r.id,
                photoId: r.photo_id,
                descriptor: r.descriptor ? Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4)) : null
            }));
        } catch (e) {
            console.error('Failed to get unassigned descriptors:', e);
            return [];
        }
    })

    ipcMain.handle('db:factoryReset', async () => {
        const { getDB } = await import('../db');

        const db = getDB();

        try {
            console.log("Commencing Factory Reset...");
            // 1. Clear Tables
            db.exec(`
            DELETE FROM photo_tags;
            DELETE FROM faces;
            DELETE FROM people;
            DELETE FROM tags;
            DELETE FROM photos;
            DELETE FROM sqlite_sequence; -- Reset autoincrement
            VACUUM;
        `);
            console.log("Database tables cleared.");

            // 2. Clear Previews
            const userDataPath = app.getPath('userData');
            const previewDir = path.join(userDataPath, 'previews');

            try {
                await fs.rm(previewDir, { recursive: true, force: true });
                await fs.mkdir(previewDir, { recursive: true }); // Recreate empty dir
                console.log("Preview directory cleared.");
            } catch (err) {
                console.error("Error clearing preview directory (non-fatal):", err);
            }

            return { success: true };
        } catch (e) {
            console.error("Factory Reset Failed:", e);
            return { success: false, error: e };
        }
    })

    ipcMain.handle('db:getUnprocessedItems', async () => {
        const db = getDB();
        try {
            // Use scan_history as the source of truth for "Processed"
            // This allows resuming scans and ensuring everything gets a history entry.
            const stmt = db.prepare(`
            SELECT id, file_path FROM photos 
            WHERE id NOT IN (SELECT photo_id FROM scan_history WHERE status = 'success')
            ORDER BY created_at DESC
        `);
            const photos = stmt.all();
            console.log(`[Main] Found ${photos.length} unprocessed items.`);
            return photos;
        } catch (error) {
            console.error('Failed to get unprocessed items:', error);
            return [];
        }
    })

    ipcMain.handle('db:autoAssignFaces', async (_event, { faceIds, threshold }) => {
        const { autoAssignFaces } = await import('../db');
        const settings = getAISettings();
        const configThreshold = settings.faceSimilarityThreshold || 0.65;
        const finalThreshold = threshold || configThreshold;

        logger.info(`[IPC] db:autoAssignFaces called with ${faceIds?.length || 'ALL'} faces. Using Threshold: ${finalThreshold}`);
        try {
            return await autoAssignFaces(faceIds, finalThreshold);
        } catch (e) {
            logger.error(`[IPC] db:autoAssignFaces error:`, e);
            throw e;
        }
    });


    ipcMain.handle('db:getPhotosForRescan', async (_event, { filter }) => {
        const { getDB } = await import('../db');
        const db = getDB();
        let query = 'SELECT id, file_path FROM photos';
        const params: any[] = [];
        const conditions: string[] = [];

        if (filter) {
            // Folder Filter
            if (filter.folder) {
                conditions.push('file_path LIKE ?');
                params.push(`${filter.folder}%`);
            }
            // Search Filter
            if (filter.search) {
                conditions.push('file_path LIKE ?');
                params.push(`%${filter.search}%`);
            }
            // Tag Filter
            if (filter.tag) {
                conditions.push('id IN (SELECT photo_id FROM photo_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)');
                params.push(filter.tag);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        try {
            const rows = db.prepare(query).all(...params);
            // Return objects with ID so frontend can map them
            return rows.map((r: any) => ({ id: r.id, file_path: r.file_path }));
        } catch (e) {
            console.error('Failed to get photos for rescan:', e);
            throw e;
        }
    });

    ipcMain.handle('db:getFilePaths', async (_event, ids: number[]) => {
        const { getDB } = await import('../db');
        const db = getDB();
        if (!ids || ids.length === 0) return [];

        const placeholders = ids.map(() => '?').join(',');
        try {
            const rows = db.prepare(`SELECT file_path, id FROM photos WHERE id IN (${placeholders})`).all(...ids);
            return rows.map((r: any) => ({ id: r.id, file_path: r.file_path }));
        } catch (e) {
            console.error('Failed to get file paths:', e);
            return [];
        }
    });

    ipcMain.handle('db:getPhoto', async (_event, photoId: number) => {
        const { getDB } = await import('../db');
        const db = getDB();
        try {
            return db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
        } catch (e) {
            console.error('Failed to get photo:', e);
            return null;
        }

        ipcMain.handle('db:debugGetFileFromPreview', async (_event, previewSubPath: string) => {
            const { getDB } = await import('../db');
            const db = getDB();
            try {
                // previewSubPath likely is just the filename or partial path. 
                // The logs show: .../previews/6aac0...
                // query using LIKE
                const row = db.prepare('SELECT file_path, id FROM photos WHERE preview_cache_path LIKE ?').get(`%${previewSubPath}%`);
                return row;
            } catch (e) {
                return null;
            }
        });

    }
    );

}

