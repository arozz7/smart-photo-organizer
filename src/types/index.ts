export interface Face {
    id: number;
    photo_id: number;
    person_id: number | null;
    box: { x: number, y: number, width: number, height: number };
    descriptor?: number[];
    file_path?: string;
    preview_cache_path?: string;
    blur_score?: number;
    width?: number;
    height?: number;
    is_ignored?: boolean;
    confidence_tier?: 'high' | 'review' | 'unknown';
    suggested_person_id?: number | null;
    match_distance?: number | null;
}

export interface Person {
    id: number;
    name: string;
    face_count?: number;
    cover_photo?: string;
    cover_face_id?: number | null;
}

export interface BlurryFace extends Face {
    photo_id: number;
    blur_score: number;
    box: { x: number, y: number, width: number, height: number };
    person_name?: string;
    preview_cache_path?: string;
    original_width?: number;
    original_height?: number;
}

export interface PotentialMatch {
    faceId: number;
    match: {
        personId: number;
        personName: string;
        similarity: number;
        distance: number;
    };
}
