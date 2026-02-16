import { getDB } from '../../db';

interface DashboardStats {
    totalPhotos: number;
    processed: number;
    pending: number;
    errorCount: number;
    namedPeople: number;
    totalFaces: number;
    unassignedFaces: number;
}

interface MemoryPhoto {
    id: number;
    file_path: string;
    preview_cache_path: string | null;
    created_at: string;
    year: number;
    width: number;
    height: number;
}

interface TopPerson {
    id: number;
    name: string;
    face_count: number;
    cover_path: string | null;
    cover_box: string | null;
    cover_width: number | null;
    cover_height: number | null;
    entity_type: string;
}

interface FunFact {
    text: string;
    type: string;
}

interface TimelineEntry {
    period: string;
    count: number;
}

interface ErrorByStage {
    stage: string;
    count: number;
}

interface LibraryHealth {
    healthScore: number;
    errorsByStage: ErrorByStage[];
    recentErrorCount: number;
    totalErrors: number;
}

export class DashboardRepository {

    /**
     * Photos taken on this day (±tolerance) in previous years.
     * Handles year-boundary wrap (e.g. Dec 30 → Jan 3).
     */
    static getOnThisDayPhotos(tolerance = 3): MemoryPhoto[] {
        const db = getDB();
        const now = new Date();
        const currentYear = now.getFullYear();

        // Build list of (month, day) pairs within ±tolerance
        const targetDates: string[] = [];
        for (let offset = -tolerance; offset <= tolerance; offset++) {
            const d = new Date(now);
            d.setDate(d.getDate() + offset);
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            targetDates.push(`${mm}-${dd}`);
        }

        const placeholders = targetDates.map(() => '?').join(',');
        const stmt = db.prepare(`
            SELECT id, file_path, preview_cache_path, created_at, width, height,
                   CAST(strftime('%Y', date_taken) AS INTEGER) as year
            FROM photos
            WHERE date_taken IS NOT NULL
              AND CAST(strftime('%Y', date_taken) AS INTEGER) < ?
              AND strftime('%m-%d', date_taken) IN (${placeholders})
            ORDER BY year DESC, date_taken DESC
            LIMIT 50
        `);

        return stmt.all(currentYear, ...targetDates) as MemoryPhoto[];
    }

    /**
     * Photos for collage generation.
     * Prefers On This Day memories; fills remainder with highest-quality photos.
     */
    static getCollagePhotos(count = 6): MemoryPhoto[] {
        const db = getDB();
        const memories = this.getOnThisDayPhotos(3);

        if (memories.length >= count) {
            // Shuffle and pick a random subset
            const shuffled = memories.sort(() => Math.random() - 0.5);
            return shuffled.slice(0, count);
        }

        // Fill remaining with high-quality photos not already in memories
        const memoryIds = new Set(memories.map(m => m.id));
        const remaining = count - memories.length;
        const placeholders = memories.length > 0
            ? `AND id NOT IN (${memories.map(() => '?').join(',')})`
            : '';
        const params = memories.length > 0 ? [...memories.map(m => m.id), remaining] : [remaining];

        const fillStmt = db.prepare(`
            SELECT id, file_path, preview_cache_path, created_at, width, height,
                   CAST(strftime('%Y', date_taken) AS INTEGER) as year
            FROM photos
            WHERE preview_cache_path IS NOT NULL
              ${placeholders}
            ORDER BY blur_score DESC, date_taken DESC
            LIMIT ?
        `);

        const fill = fillStmt.all(...params) as MemoryPhoto[];
        return [...memories, ...fill.filter(p => !memoryIds.has(p.id))].slice(0, count);
    }

    /**
     * Aggregate library stats for the dashboard.
     */
    static getDashboardStats(): DashboardStats {
        const db = getDB();

        const totalPhotos = (db.prepare('SELECT COUNT(*) as c FROM photos').get() as any).c;
        const processed = (db.prepare('SELECT COUNT(*) as c FROM photos WHERE blur_score IS NOT NULL').get() as any).c;
        const errorCount = (db.prepare('SELECT COUNT(*) as c FROM scan_errors').get() as any).c;
        const namedPeople = (db.prepare('SELECT COUNT(*) as c FROM people').get() as any).c;
        const totalFaces = (db.prepare('SELECT COUNT(*) as c FROM faces WHERE is_ignored = 0').get() as any).c;
        const unassignedFaces = (db.prepare('SELECT COUNT(*) as c FROM faces WHERE person_id IS NULL AND is_ignored = 0').get() as any).c;

        return {
            totalPhotos,
            processed,
            pending: totalPhotos - processed,
            errorCount,
            namedPeople,
            totalFaces,
            unassignedFaces,
        };
    }

    /**
     * Top N people by face count with cover photo info.
     */
    static getTopPeople(limit = 10): TopPerson[] {
        const db = getDB();
        const stmt = db.prepare(`
            SELECT p.id, p.name, p.entity_type,
                   COUNT(f.id) as face_count,
                   COALESCE(cover_photo.preview_cache_path, cover_photo.file_path) as cover_path,
                   cover_face.box_json as cover_box,
                   cover_photo.width as cover_width,
                   cover_photo.height as cover_height
            FROM people p
            LEFT JOIN faces f ON f.person_id = p.id AND f.is_ignored = 0
            LEFT JOIN faces cover_face ON p.cover_face_id = cover_face.id
            LEFT JOIN photos cover_photo ON cover_face.photo_id = cover_photo.id
            GROUP BY p.id
            HAVING face_count > 0
            ORDER BY face_count DESC
            LIMIT ?
        `);
        return stmt.all(limit) as TopPerson[];
    }

    /**
     * Most recently scanned photos.
     */
    static getRecentScans(limit = 12): any[] {
        const db = getDB();
        const stmt = db.prepare(`
            SELECT DISTINCT p.id, p.file_path, p.preview_cache_path, p.created_at,
                   p.width, p.height, sh.timestamp as scan_timestamp
            FROM scan_history sh
            JOIN photos p ON sh.photo_id = p.id
            WHERE sh.status = 'success'
            ORDER BY sh.timestamp DESC
            LIMIT ?
        `);
        return stmt.all(limit);
    }

    /**
     * Generate a random fun fact about the library.
     */
    static getFunFact(): FunFact {
        const db = getDB();
        const facts: FunFact[] = [];

        // Library age span
        const dateRange = db.prepare(`
            SELECT MIN(date_taken) as oldest, MAX(date_taken) as newest
            FROM photos WHERE date_taken IS NOT NULL
        `).get() as any;
        if (dateRange?.oldest && dateRange?.newest) {
            const oldestYear = new Date(dateRange.oldest).getFullYear();
            const newestYear = new Date(dateRange.newest).getFullYear();
            const span = newestYear - oldestYear;
            if (span > 0) {
                facts.push({ text: `Your library spans ${span} years, from ${oldestYear} to ${newestYear}!`, type: 'span' });
            }
        }

        // Most photographed month
        const topMonth = db.prepare(`
            SELECT strftime('%Y-%m', date_taken) as month, COUNT(*) as cnt
            FROM photos WHERE date_taken IS NOT NULL
            GROUP BY month ORDER BY cnt DESC LIMIT 1
        `).get() as any;
        if (topMonth) {
            const [year, mon] = topMonth.month.split('-');
            const monthName = new Date(Number(year), Number(mon) - 1).toLocaleString('default', { month: 'long' });
            facts.push({ text: `Your most active month was ${monthName} ${year} with ${topMonth.cnt} photos!`, type: 'topMonth' });
        }

        // Person with most photos
        const topPerson = db.prepare(`
            SELECT p.name, COUNT(f.id) as cnt
            FROM people p JOIN faces f ON f.person_id = p.id AND f.is_ignored = 0
            GROUP BY p.id ORDER BY cnt DESC LIMIT 1
        `).get() as any;
        if (topPerson) {
            facts.push({ text: `${topPerson.name} appears in ${topPerson.cnt} photos — your most photographed person!`, type: 'topPerson' });
        }

        // Total faces detected
        const totalFaces = (db.prepare('SELECT COUNT(*) as c FROM faces').get() as any).c;
        if (totalFaces > 0) {
            facts.push({ text: `The AI has detected ${totalFaces.toLocaleString()} faces across your library!`, type: 'totalFaces' });
        }

        // Peak year
        const peakYear = db.prepare(`
            SELECT CAST(strftime('%Y', date_taken) AS INTEGER) as year, COUNT(*) as cnt
            FROM photos WHERE date_taken IS NOT NULL
            GROUP BY year ORDER BY cnt DESC LIMIT 1
        `).get() as any;
        if (peakYear) {
            facts.push({ text: `${peakYear.year} was your biggest year with ${peakYear.cnt} photos!`, type: 'peakYear' });
        }

        // Most common camera model
        const topCamera = db.prepare(`
            SELECT json_extract(metadata_json, '$.Model') as model, COUNT(*) as cnt
            FROM photos
            WHERE metadata_json IS NOT NULL
              AND json_extract(metadata_json, '$.Model') IS NOT NULL
            GROUP BY model ORDER BY cnt DESC LIMIT 1
        `).get() as any;
        if (topCamera?.model) {
            facts.push({ text: `Your most-used camera is ${topCamera.model} with ${topCamera.cnt} photos!`, type: 'topCamera' });
        }

        // Most popular tag
        const topTag = db.prepare(`
            SELECT t.name, COUNT(pt.photo_id) as cnt
            FROM tags t JOIN photo_tags pt ON t.id = pt.tag_id
            GROUP BY t.id ORDER BY cnt DESC LIMIT 1
        `).get() as any;
        if (topTag) {
            facts.push({ text: `"${topTag.name}" is your most common tag, applied to ${topTag.cnt} photos!`, type: 'topTag' });
        }

        // Busiest day of week
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const busiestDay = db.prepare(`
            SELECT CAST(strftime('%w', date_taken) AS INTEGER) as dow, COUNT(*) as cnt
            FROM photos WHERE date_taken IS NOT NULL
            GROUP BY dow ORDER BY cnt DESC LIMIT 1
        `).get() as any;
        if (busiestDay) {
            facts.push({ text: `You take the most photos on ${dayNames[busiestDay.dow]}s!`, type: 'busiestDay' });
        }

        // Average photos per month
        const monthlyAvg = db.prepare(`
            SELECT COUNT(*) as total,
                   COUNT(DISTINCT strftime('%Y-%m', date_taken)) as months
            FROM photos WHERE date_taken IS NOT NULL
        `).get() as any;
        if (monthlyAvg?.months > 0) {
            const avg = Math.round(monthlyAvg.total / monthlyAvg.months);
            facts.push({ text: `You average about ${avg} photos per month across your library!`, type: 'monthlyAvg' });
        }

        if (facts.length === 0) {
            return { text: 'Start scanning photos to discover fun facts about your library!', type: 'empty' };
        }

        return facts[Math.floor(Math.random() * facts.length)];
    }

    /**
     * Yearly photo counts for the timeline widget.
     */
    static getPhotoTimeline(): TimelineEntry[] {
        const db = getDB();
        const stmt = db.prepare(`
            SELECT CAST(strftime('%Y', date_taken) AS TEXT) as period,
                   COUNT(*) as count
            FROM photos
            WHERE date_taken IS NOT NULL
            GROUP BY period
            ORDER BY period ASC
        `);
        return stmt.all() as TimelineEntry[];
    }

    /**
     * Monthly photo counts for a specific year (timeline drill-down).
     */
    static getMonthlyBreakdown(year: number): TimelineEntry[] {
        const db = getDB();
        const stmt = db.prepare(`
            SELECT CAST(strftime('%m', date_taken) AS TEXT) as period,
                   COUNT(*) as count
            FROM photos
            WHERE date_taken IS NOT NULL
              AND strftime('%Y', date_taken) = ?
            GROUP BY period
            ORDER BY period ASC
        `);
        return stmt.all(String(year)) as TimelineEntry[];
    }

    /**
     * Library health metrics: health score, errors by stage, recent error trend.
     */
    static getLibraryHealth(): LibraryHealth {
        const db = getDB();

        const totalPhotos = (db.prepare('SELECT COUNT(*) as c FROM photos').get() as any).c;
        const processed = (db.prepare('SELECT COUNT(*) as c FROM photos WHERE blur_score IS NOT NULL').get() as any).c;

        const healthScore = totalPhotos > 0 ? Math.round((processed / totalPhotos) * 100) : 100;

        const errorsByStage = db.prepare(`
            SELECT stage, COUNT(*) as count
            FROM scan_errors
            GROUP BY stage
            ORDER BY count DESC
        `).all() as ErrorByStage[];

        const totalErrors = (db.prepare('SELECT COUNT(*) as c FROM scan_errors').get() as any).c;

        const recentErrorCount = (db.prepare(`
            SELECT COUNT(*) as c FROM scan_errors
            WHERE timestamp > datetime('now', '-7 days')
        `).get() as any).c;

        return { healthScore, errorsByStage, recentErrorCount, totalErrors };
    }

    /**
     * Photo locations clustered by GPS coordinates for the heatmap widget.
     * Returns empty array if no GPS data is available.
     */
    static getPhotoLocations(): LocationCluster[] {
        const db = getDB();
        try {
            const clusters = db.prepare(`
                SELECT 
                    ROUND(CAST(json_extract(metadata_json, '$.GPSLatitude') AS REAL), 1) as lat,
                    ROUND(CAST(json_extract(metadata_json, '$.GPSLongitude') AS REAL), 1) as lng,
                    COUNT(*) as photoCount
                FROM photos
                WHERE metadata_json IS NOT NULL
                  AND json_extract(metadata_json, '$.GPSLatitude') IS NOT NULL
                  AND json_extract(metadata_json, '$.GPSLongitude') IS NOT NULL
                  AND CAST(json_extract(metadata_json, '$.GPSLatitude') AS REAL) BETWEEN -90 AND 90
                  AND CAST(json_extract(metadata_json, '$.GPSLongitude') AS REAL) BETWEEN -180 AND 180
                GROUP BY lat, lng
                ORDER BY photoCount DESC
                LIMIT 500
            `).all() as LocationCluster[];
            return clusters;
        } catch (err) {
            console.error('[DashboardRepository] Failed to query photo locations:', err);
            return [];
        }
    }
}

interface LocationCluster {
    lat: number;
    lng: number;
    photoCount: number;
}
