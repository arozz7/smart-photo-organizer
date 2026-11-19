/**
 * Which unassigned faces are worth a person's time to review?
 *
 * Reviewing tens of thousands of unassigned faces by hand takes hours, and most are strangers who appear once or faces
 * too small or blurry to recognise. A face is "parked" when it is unassigned, not ignored, and either
 *   - low quality: the face box is small or the image blurry, or
 *   - a singleton: no other unassigned face is a twin (close enough to be the same person), and it is not close to a
 *     named person either (such a face is a likely match for them and stays in review).
 * A twin must come from a different shot: the same photo saved twice, a RAW file and its exported JPG, or frames taken
 * in the same second are one appearance, not a recurring person (see assignShotIds).
 * Parked is a view, not a state: nothing is ignored or deleted, and a face leaves it by itself when it gains a twin
 * or a person is named near it. See docs/plans/review-queue-parking-plan.md.
 *
 * This file is pure decision logic; the measuring (twin counts) happens in the AI backend.
 */

export interface ParkedSettings {
    /** Face box area (pixels squared) below which a face is too small to recognise. 8,000 is about 90 x 90. */
    minFaceArea: number;
    /** Blur score below which the image is too blurry. */
    minBlurScore: number;
    /** L2 distance within which another face counts as a twin. */
    twinDistance: number;
    /** A second, looser twin distance reported for comparison (the background grouping uses about 0.58). */
    alternativeTwinDistance: number;
    /** L2 distance to a named person's centroid within which a lone face is a likely match and is not parked. */
    suggestionDistance: number;
    /** L2 distance at or below which two faces are exact copies (the same face in a copied photo), whatever their shot. */
    duplicateDistance: number;
}

export const DEFAULT_PARKED_SETTINGS: ParkedSettings = {
    minFaceArea: 8_000,
    minBlurScore: 60,
    twinDistance: 0.5,
    alternativeTwinDistance: 0.58,
    suggestionDistance: 0.8,
    duplicateDistance: 0.001,
};

/** What was measured for one unassigned face. A null size or blur means "not measured": quality is then not judged. */
export interface FaceMeasure {
    area: number | null;
    blur: number | null;
    /** Other unassigned faces within twinDistance, not counting exact copies or faces of the same shot. */
    twins: number;
    /** The same within alternativeTwinDistance. */
    twinsAtAlternative: number;
    /** Faces within twinDistance that were left out because they are exact copies or the same shot. */
    sameShot: number;
    /** L2 distance to the nearest named person's centroid; null when nobody is named. */
    nearestCentroid: number | null;
}

export type FaceCategory = 'lowQuality' | 'singleton' | 'worthReviewing';

export interface FaceClassification {
    category: FaceCategory;
    /** A lone face that is kept for review only because it is near a named person. */
    nearNamed: boolean;
}

export interface ParkedSummary {
    unassigned: number;
    lowQuality: number;
    singleton: number;
    /** Kept for review although they have no twin, because a named person is near. A subset of worthReviewing. */
    nearNamed: number;
    /** lowQuality + singleton. */
    parked: number;
    /** unassigned - parked. */
    worthReviewing: number;
    /** Clear faces whose only close faces are the same shot saved again (copies, RAW plus JPG, burst frames). */
    sameShotOnly: number;
    /** Lone, clear faces within each of several distances of a named person: how the "near a named person" cut-off matters. */
    nearNamedByDistance: { distance: number; count: number }[];
    /** How many faces would be singletons at the alternative twin distance. */
    singletonAtAlternativeDistance: number;
    settings: ParkedSettings;
}

/** Face box area from the stored box JSON ({"x","y","width","height"}); null when it cannot be read. */
export function faceBoxArea(boxJson: string | null): number | null {
    if (!boxJson) return null;
    try {
        const box = JSON.parse(boxJson) as { width?: unknown; height?: unknown };
        const { width, height } = box;
        if (typeof width !== 'number' || typeof height !== 'number') return null;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null;
        return width * height;
    } catch {
        return null;
    }
}

function isLowQuality(face: FaceMeasure, settings: ParkedSettings): boolean {
    const tooSmall = face.area !== null && face.area < settings.minFaceArea;
    const tooBlurry = face.blur !== null && face.blur < settings.minBlurScore;
    return tooSmall || tooBlurry;
}

export function classifyFace(face: FaceMeasure, settings: ParkedSettings): FaceClassification {
    if (isLowQuality(face, settings)) return { category: 'lowQuality', nearNamed: false };
    if (face.twins >= 1) return { category: 'worthReviewing', nearNamed: false };
    const nearNamedPerson = face.nearestCentroid !== null && face.nearestCentroid <= settings.suggestionDistance;
    if (nearNamedPerson) return { category: 'worthReviewing', nearNamed: true };
    return { category: 'singleton', nearNamed: false };
}

/** Distances at which the summary reports how many lone faces are near a named person (there is no natural cut-off). */
export const NEAR_NAMED_REPORT_DISTANCES = [0.5, 0.6, 0.7, 0.8];

export function summariseParked(faces: FaceMeasure[], settings: ParkedSettings): ParkedSummary {
    let lowQuality = 0;
    let singleton = 0;
    let nearNamed = 0;
    let sameShotOnly = 0;
    let singletonAtAlternativeDistance = 0;
    const nearNamedCounts = NEAR_NAMED_REPORT_DISTANCES.map(() => 0);

    for (const face of faces) {
        const result = classifyFace(face, settings);
        if (result.category === 'lowQuality') lowQuality++;
        if (result.category === 'singleton') singleton++;
        if (result.nearNamed) nearNamed++;

        const isLoneFace = result.category !== 'lowQuality' && face.twins === 0;
        if (isLoneFace && face.sameShot > 0) sameShotOnly++;
        if (isLoneFace && !result.nearNamed && face.twinsAtAlternative === 0) singletonAtAlternativeDistance++;
        if (isLoneFace && face.nearestCentroid !== null) {
            NEAR_NAMED_REPORT_DISTANCES.forEach((distance, i) => {
                if (face.nearestCentroid! <= distance) nearNamedCounts[i]++;
            });
        }
    }

    const parked = lowQuality + singleton;
    return {
        unassigned: faces.length,
        lowQuality,
        singleton,
        nearNamed,
        parked,
        worthReviewing: faces.length - parked,
        sameShotOnly,
        nearNamedByDistance: NEAR_NAMED_REPORT_DISTANCES.map((distance, i) => ({ distance, count: nearNamedCounts[i] })),
        singletonAtAlternativeDistance,
        settings,
    };
}

export interface ShotInput {
    photoId: number;
    filePath: string | null;
    dateTaken: string | null;
}

/** Folder (lower case) and file name without extension (lower case); null when there is no path. */
function folderAndStem(filePath: string | null): string | null {
    if (!filePath) return null;
    const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const folder = filePath.slice(0, cut + 1).toLowerCase();
    const name = filePath.slice(cut + 1);
    const dot = name.lastIndexOf('.');
    const stem = (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
    return stem ? `${folder}|${stem}` : null;
}

/**
 * Labels each face with the shot it came from; faces with the same label are one shot.
 *
 * One shot often exists as several files: a RAW file and the JPG exported from it, an edited copy, a copy in another
 * folder, or several frames within one second. Their faces are not twins of each other, because a person who is
 * photographed once should not look like someone who recurs. Two photos are the same shot when they are
 *   - the same photo,
 *   - the same file name (ignoring the extension) in the same folder, or
 *   - taken in the same second, unless many photos share that second (then it is a placeholder date, not a moment).
 * The links chain: A and B by name, B and C by time make one shot.
 */
export function assignShotIds(faces: ShotInput[], maxPhotosPerCaptureTime = 20): number[] {
    const photosAtTime = new Map<string, Set<number>>();
    for (const face of faces) {
        if (!face.dateTaken) continue;
        if (!photosAtTime.has(face.dateTaken)) photosAtTime.set(face.dateTaken, new Set());
        photosAtTime.get(face.dateTaken)!.add(face.photoId);
    }

    const parent = new Map<string, string>();
    const find = (key: string): string => {
        if (!parent.has(key)) parent.set(key, key);
        let root = key;
        while (parent.get(root) !== root) root = parent.get(root)!;
        // point everything on the path straight at the root, so later lookups are short
        let node = key;
        while (node !== root) {
            const next = parent.get(node)!;
            parent.set(node, root);
            node = next;
        }
        return root;
    };
    const union = (a: string, b: string) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootB, rootA);
    };

    const photoKeys = faces.map(face => `photo:${face.photoId}`);
    faces.forEach((face, i) => {
        find(photoKeys[i]);
        const nameKey = folderAndStem(face.filePath);
        if (nameKey) union(photoKeys[i], `name:${nameKey}`);
        const crowd = face.dateTaken ? photosAtTime.get(face.dateTaken)!.size : 0;
        if (face.dateTaken && crowd <= maxPhotosPerCaptureTime) union(photoKeys[i], `time:${face.dateTaken}`);
    });

    const labels = new Map<string, number>();
    return photoKeys.map(key => {
        const root = find(key);
        if (!labels.has(root)) labels.set(root, labels.size);
        return labels.get(root)!;
    });
}

/** The parts of a named person that hold centroids (the shape PersonRepository.getPeopleWithDescriptors returns). */
export interface PersonCentroids {
    entity_type?: string;
    descriptor?: number[] | null;
    eras?: { centroid?: number[] | null }[];
    poseCentroids?: (number[] | null)[];
}

/**
 * Every centroid an unassigned human face is compared with: each person's overall centroid, era centroids and pose
 * centroids (the same set the background grouping matches against). Pets are left out; centroids that are missing or
 * of the wrong length are skipped.
 */
export function collectCentroids(people: PersonCentroids[], dim: number): number[][] {
    const centroids: number[][] = [];
    const add = (vector: number[] | null | undefined) => {
        if (Array.isArray(vector) && vector.length === dim) centroids.push(vector);
    };
    for (const person of people) {
        if ((person.entity_type ?? 'human') !== 'human') continue;
        add(person.descriptor);
        for (const era of person.eras ?? []) add(era.centroid);
        for (const pose of person.poseCentroids ?? []) add(pose);
    }
    return centroids;
}

/** Size and identity of the set of unassigned faces (the sums tell sets of equal size apart). */
export interface UnassignedFingerprint {
    count: number;
    idSum: number;
    idSquareSum: number;
}

export function formatUnassignedFingerprint(fingerprint: UnassignedFingerprint): string {
    return `${fingerprint.count}:${fingerprint.idSum}:${fingerprint.idSquareSum}`;
}

/** The summary only changes when the faces, the named people or the thresholds change: that is its cache key. */
export function parkedSummaryCacheKey(fingerprint: UnassignedFingerprint, centroidsKey: string, settings: ParkedSettings): string {
    return [formatUnassignedFingerprint(fingerprint), centroidsKey, JSON.stringify(settings)].join('|');
}
