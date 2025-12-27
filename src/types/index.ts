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
}

export interface Person {
    id: number;
    name: string;
    face_count?: number;
    cover_photo?: string;
}
