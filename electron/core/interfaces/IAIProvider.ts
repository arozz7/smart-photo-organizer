/**
 * How a request reaches the AI engine, which handles one command at a time. `foreground` (the default) is written at once; `background` work
 * (captions, face checks, grouping batches) waits while a request someone is waiting for is outstanding, and runs one at a time.
 */
export interface RequestOptions {
    lane?: 'foreground' | 'background';
}

/** The options of every request a background service makes. */
export const BACKGROUND: RequestOptions = { lane: 'background' };

export interface IAIProvider {
    analyzeImage(filePath: string, options?: any): Promise<any>;
    clusterFaces(faces: { id: number, descriptor: number[]; pose_yaw?: number | null }[], eps?: number, minSamples?: number, anchorOnlyFrontal?: boolean, timeoutMs?: number, requestOptions?: RequestOptions): Promise<any>;
    searchFaces(descriptors: number[][], k?: number, threshold?: number, timeoutMs?: number): Promise<{ id: number, distance: number }[][]>;
    generateThumbnail(filePath: string, options?: any): Promise<any>;
    rotateImage(filePath: string, rotation: number): Promise<any>;
    checkStatus(): Promise<any>;
}
