/**
 * Legacy library fixture builder.
 *
 * Creates a library.db using the REAL `initDB` (as shipped in v0.8.1) and seeds it with
 * representative user data. The committed output is used by migration tests to prove that
 * upgrades never lose data from existing libraries.
 *
 * Run from the repo root (the vitest environment supplies the better-sqlite3 ABI and electron mock):
 *   $env:BUILD_LEGACY_FIXTURE = "1"; node scripts/run-tests.cjs tests/tools/buildLegacyFixture.test.ts
 *
 * IMPORTANT: Regenerate ONLY from code that still contains the legacy initDB. Once migrations
 * are refactored, the committed fixture is the frozen source of truth.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const FIXTURE_DB_NAME = 'legacy-v0.8.1.db';
export const FIXTURE_SNAPSHOT_NAME = 'legacy-v0.8.1.snapshot.json';

export interface LegacySnapshot {
    /** Every table/index/trigger definition, keyed by "type:name". */
    schema: Record<string, string>;
    /** Row count per user table. */
    rowCounts: Record<string, number>;
}

const FLOATS_512 = (seed: number): Buffer => {
    const buf = Buffer.alloc(512 * 4);
    for (let i = 0; i < 512; i++) buf.writeFloatLE(Math.sin(seed + i) * 0.1, i * 4);
    return buf;
};

function seed(db: Database.Database): void {
    const insertPhoto = db.prepare(`
        INSERT INTO photos (file_path, file_hash, preview_cache_path, created_at, date_taken, width, height,
                            blur_score, metadata_json, description, sha256_hash, phash)
        VALUES (@file_path, @file_hash, @preview, @created_at, @date_taken, @width, @height,
                @blur_score, @metadata_json, @description, @sha256, @phash)`);

    const photos = [
        { n: 'D:/Photos/2019/IMG_0001.jpg', sha: 'aa01', ph: 'ffff0000ffff0000', desc: 'Two kids at the beach' },
        { n: 'D:/Photos/2019/IMG_0002.jpg', sha: 'aa02', ph: 'ffff0000ffff0001', desc: 'Sunset over water' },
        { n: 'D:/Photos/2019/IMG_0003.CR2', sha: 'aa03', ph: '0f0f0f0f0f0f0f0f', desc: null },
        // Same bytes stored at two paths (exact-duplicate pair, also the shape of a "ghost" pair)
        { n: 'D:/Photos/Old/IMG_0001.jpg', sha: 'aa01', ph: 'ffff0000ffff0000', desc: 'Two kids at the beach' },
        { n: 'D:/Photos/2021/IMG_0100.png', sha: 'aa04', ph: '1234567812345678', desc: 'A dog in a park' },
        { n: 'D:/Photos/2021/IMG_0101.jpg', sha: null, ph: null, desc: null }, // never hashed
    ];
    photos.forEach((p, i) => {
        insertPhoto.run({
            file_path: p.n,
            file_hash: null,
            preview: `D:/Library/previews/${i + 1}.jpg`,
            created_at: '2024-01-01 10:00:00',
            date_taken: `2019-0${(i % 9) + 1}-15T12:00:00.000Z`,
            width: 4000,
            height: 3000,
            blur_score: 120 + i,
            metadata_json: JSON.stringify({ Make: 'Canon', Model: 'EOS R', GPSLatitude: 48.85 + i / 100, GPSLongitude: 2.35 }),
            description: p.desc,
            sha256: p.sha,
            phash: p.ph,
        });
    });

    // Tags
    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
    ['beach', 'dog', 'sunset'].forEach(t => insertTag.run(t));
    const insertPhotoTag = db.prepare('INSERT INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)');
    insertPhotoTag.run(1, 1, 'ai');
    insertPhotoTag.run(2, 3, 'ai');
    insertPhotoTag.run(5, 2, 'user');

    // People (named), eras
    const insertPerson = db.prepare('INSERT INTO people (name, descriptor_mean_json, entity_type) VALUES (?, ?, ?)');
    insertPerson.run('Alice', JSON.stringify(Array.from({ length: 4 }, (_, i) => i / 10)), 'human');
    insertPerson.run('Bob', JSON.stringify(Array.from({ length: 4 }, (_, i) => i / 20)), 'human');
    insertPerson.run('Rex', null, 'pet');

    db.prepare(`INSERT INTO person_eras (person_id, era_name, user_name, start_year, end_year, centroid_json, face_count, is_auto_generated, created_at)
                VALUES (1, 'Child', 'Beach years', 2018, 2020, '[0.1,0.2]', 2, 1, 1700000000)`).run();
    db.prepare(`INSERT INTO person_history (person_id, descriptor_json, face_count, reason) VALUES (1, '[0.1]', 2, 'snapshot')`).run();
    db.prepare(`INSERT INTO person_alerts (person_id, alert_type, message, drift_distance) VALUES (2, 'drift', 'Identity drift', 0.42)`).run();

    // Buckets
    db.prepare(`INSERT INTO face_buckets (bucket_type, suggested_person_id, status, face_count) VALUES ('discovery', NULL, 'active', 1)`).run();
    db.prepare(`INSERT INTO face_buckets (bucket_type, suggested_person_id, status, face_count) VALUES ('suggestion', 1, 'active', 1)`).run();

    // Faces: confirmed-named, auto-assigned, suggested, ignored (user), bucketed, unknown, pet
    const insertFace = db.prepare(`
        INSERT INTO faces (photo_id, box_json, descriptor, descriptor_v2, person_id, is_ignored, ignore_source, score, blur_score,
                           bucket_id, needs_bucketing, pose_yaw, face_quality, confidence_tier, assignment_source, is_confirmed,
                           suggested_person_id, match_distance, era_id, estimated_age, gender, entity_type)
        VALUES (@photo_id, @box, @d, @d2, @person_id, @ignored, @ignore_source, @score, @blur, @bucket_id, @needs_bucketing, @yaw,
                @quality, @tier, @source, @confirmed, @suggested, @dist, @era_id, @age, @gender, @entity)`);
    const base = { d: FLOATS_512(1), d2: FLOATS_512(2), score: 0.99, blur: 150, needs_bucketing: 0, yaw: 5, quality: 0.9, entity: 'human',
                   ignore_source: null, bucket_id: null, suggested: null, dist: null, era_id: null, age: null, gender: null, ignored: 0 };
    const faces = [
        { ...base, photo_id: 1, box: '{"x":10,"y":10,"width":100,"height":100}', person_id: 1, tier: 'high', source: 'manual', confirmed: 1, era_id: 1, age: 8, gender: 'F' },
        { ...base, photo_id: 1, box: '{"x":200,"y":10,"width":100,"height":100}', person_id: 2, tier: 'high', source: 'auto', confirmed: 0 },
        { ...base, photo_id: 2, box: '{"x":10,"y":10,"width":90,"height":90}', person_id: 1, tier: 'medium', source: 'manual', confirmed: 1, era_id: 1 },
        { ...base, photo_id: 4, box: '{"x":10,"y":10,"width":100,"height":100}', person_id: null, tier: 'unknown', source: 'auto', confirmed: 0, suggested: 1, dist: 0.31 },
        { ...base, photo_id: 5, box: '{"x":50,"y":50,"width":60,"height":60}', person_id: 3, tier: 'high', source: 'manual', confirmed: 1, entity: 'pet' },
        { ...base, photo_id: 5, box: '{"x":300,"y":50,"width":40,"height":40}', person_id: null, tier: 'unknown', source: 'auto', confirmed: 0, ignored: 1, ignore_source: 'user' },
        { ...base, photo_id: 4, box: '{"x":400,"y":50,"width":40,"height":40}', person_id: null, tier: 'unknown', source: 'auto', confirmed: 0, bucket_id: 1, needs_bucketing: 1 },
        { ...base, photo_id: 6, box: '{"x":5,"y":5,"width":30,"height":30}', person_id: null, tier: 'unknown', source: 'auto', confirmed: 0, quality: 0.2, blur: 12 },
    ];
    faces.forEach(f => insertFace.run(f));
    db.prepare('UPDATE people SET cover_face_id = 1 WHERE id = 1').run();

    // Smart albums (saved filters)
    const insertAlbum = db.prepare('INSERT INTO smart_albums (name, filter_json) VALUES (?, ?)');
    insertAlbum.run('Alice at the beach', JSON.stringify({ operator: 'AND', rules: [{ type: 'person', value: 1 }, { type: 'tag', value: 'beach' }] }));
    insertAlbum.run('Sharp 2019', JSON.stringify({ operator: 'AND', rules: [{ type: 'year', value: 2019 }, { type: 'blur', min: 100 }] }));

    // Duplicate group (exact) with a winner
    db.prepare(`INSERT INTO duplicate_groups (type, status, winner_photo_id) VALUES ('exact', 'pending', 1)`).run();
    db.prepare('UPDATE photos SET duplicate_group_id = 1 WHERE id IN (1, 4)').run();

    // Errors / history
    db.prepare(`INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (6, 'D:/Photos/2021/IMG_0101.jpg', 'corrupt header', 'scan')`).run();
    db.prepare(`INSERT INTO scan_history (photo_id, file_path, scan_ms, tag_ms, face_count, scan_mode, status, timestamp)
                VALUES (1, 'D:/Photos/2019/IMG_0001.jpg', 420, 300, 2, 'FAST', 'success', 1700000000000)`).run();
}

export function snapshotDatabase(db: Database.Database): LegacySnapshot {
    const schema: Record<string, string> = {};
    const rows = db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name`)
        .all() as { type: string; name: string; sql: string }[];
    rows.forEach(r => { schema[`${r.type}:${r.name}`] = r.sql.replace(/\s+/g, ' ').trim(); });

    const rowCounts: Record<string, number> = {};
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[])
        .forEach(t => { rowCounts[t.name] = (db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }).c; });
    return { schema, rowCounts };
}

/** Builds the fixture DB + snapshot into `outDir`, using the real initDB. */
export async function buildLegacyFixture(outDir: string): Promise<{ dbPath: string; snapshotPath: string }> {
    const workDir = fs.mkdtempSync(path.join(outDir, '.build-'));
    const { initDB, getDB, closeDB } = await import('../../electron/db');
    await initDB(workDir);

    const dbPath = path.join(workDir, 'library.db');
    const db: Database.Database = getDB();
    seed(db);
    const snapshot = snapshotDatabase(db);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    closeDB();

    const finalDb = path.join(outDir, FIXTURE_DB_NAME);
    const finalSnapshot = path.join(outDir, FIXTURE_SNAPSHOT_NAME);
    fs.copyFileSync(dbPath, finalDb);
    fs.writeFileSync(finalSnapshot, JSON.stringify(snapshot, null, 2) + '\n');
    fs.rmSync(workDir, { recursive: true, force: true });
    return { dbPath: finalDb, snapshotPath: finalSnapshot };
}
