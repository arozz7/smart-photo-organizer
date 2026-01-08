export interface IAIProvider {
    analyzeImage(filePath: string, options?: any): Promise<any>;
    clusterFaces(faces: { id: number, descriptor: number[] }[], eps?: number, minSamples?: number, timeoutMs?: number): Promise<any>;
    searchFaces(descriptors: number[][], k?: number, threshold?: number, timeoutMs?: number): Promise<{ id: number, distance: number }[][]>;
    generateThumbnail(filePath: string, options?: any): Promise<any>;
    rotateImage(filePath: string, rotation: number): Promise<any>;
    checkStatus(): Promise<any>;
}
