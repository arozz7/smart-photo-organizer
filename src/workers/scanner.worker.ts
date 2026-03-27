import * as tf from '@tensorflow/tfjs';
// @ts-ignore
import { pipeline, env } from '@xenova/transformers';
import { Human, Config } from '@vladmandic/human';

// Configuration
env.allowLocalModels = false;
env.useBrowserCache = false;

// Basic Mock Classes to satisfy libraries if needed
class MockElement { }
class MockImage extends MockElement {
    width: number = 0;
    height: number = 0;
    src: string = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
}
class MockVideo extends MockElement { }

// Apply global polyfills
// @ts-ignore
self.window = self;
// @ts-ignore
self.document = {
    createElement: (tag: string) => {
        if (tag === 'canvas') return new OffscreenCanvas(500, 500);
        if (tag === 'img') return new MockImage();
        return new MockElement();
    },
    head: {},
    body: {}
} as any;
// @ts-ignore
self.HTMLImageElement = MockImage;
// @ts-ignore
self.HTMLVideoElement = MockVideo;
// @ts-ignore
self.HTMLCanvasElement = OffscreenCanvas;
// @ts-ignore
self.CanvasRenderingContext2D = OffscreenCanvasRenderingContext2D;
// @ts-ignore
self.Element = MockElement;
// @ts-ignore
self.Image = MockImage;

let human: Human | null = null;
let clipPipeline: any = null;
let isModelsLoaded = false;

const LABEL_TAXONOMY: Record<string, string[]> = {
    scenes: ['outdoor', 'indoor', 'portrait', 'landscape', 'macro', 'aerial', 'underwater', 'night', 'studio'],
    nature: ['forest', 'mountain', 'lake', 'river', 'ocean', 'beach', 'desert', 'snow', 'garden', 'waterfall', 'sunset', 'sunrise', 'sky', 'clouds', 'rainbow', 'stars'],
    urban: ['city', 'building', 'street', 'bridge', 'skyline', 'architecture', 'parking', 'store', 'restaurant', 'cafe', 'vehicle', 'car'],
    interior: ['room', 'kitchen', 'bedroom', 'bathroom', 'office', 'classroom', 'gym', 'church', 'museum', 'library'],
    people: ['portrait', 'group photo', 'selfie', 'crowd', 'wedding', 'party', 'concert', 'sports', 'graduation', 'birthday'],
    animals: ['dog', 'cat', 'bird', 'horse', 'fish', 'rabbit', 'deer', 'bear', 'butterfly', 'insect', 'reptile', 'pet'],
    objects: ['bicycle', 'motorcycle', 'boat', 'airplane', 'train', 'food', 'drink', 'flower', 'book', 'phone', 'computer', 'guitar', 'clock', 'sign', 'drawing', 'text', 'screenshot'],
    activities: ['cooking', 'eating', 'dancing', 'swimming', 'hiking', 'reading', 'playing', 'running', 'cycling', 'shopping'],
    style: ['black and white', 'vintage', 'artistic', 'minimalist', 'abstract', 'panorama', 'long exposure'],
    mood: ['happy', 'peaceful', 'dramatic', 'romantic', 'mysterious', 'festive', 'cozy'],
};

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        await initModels(payload?.profile);
    } else if (type === 'process') {
        if (!isModelsLoaded) {
            postMessage({ type: 'error', error: 'Models not loaded yet' });
            return;
        }
        await processImage(payload);
    }
};

async function initModels(profile: string = 'balanced') {
    try {
        console.log(`[Worker] Loading AI models (Profile: ${profile})...`);
        const isHighAccuracy = profile === 'high';

        await tf.ready();

        // 1. Initialize Human (Face Detection & Recognition)
        const humanConfig: Partial<Config> = {
            modelBasePath: '/models', // Point to public/models
            backend: 'webgl',
            face: {
                enabled: true,
                detector: {
                    enabled: true,
                    modelPath: 'blazeface.json', // Use BlazeFace (RetinaFace-like)
                    maxDetected: 20,
                    minConfidence: isHighAccuracy ? 0.5 : 0.4, // Relaxed based on user feedback (was 0.6/0.5)
                    return: true
                },
                mesh: { enabled: false }, // Don't need 3D mesh
                iris: { enabled: false },
                description: {
                    enabled: true,
                    modelPath: 'faceres.json', // Use faceres (Human's default recognition model)
                },
                emotion: { enabled: false }
            },
            body: { enabled: false },
            hand: { enabled: false },
            object: { enabled: false },
            gesture: { enabled: false },
            filter: { enabled: false }
        };

        human = new Human(humanConfig);
        await human.load(); // Pre-load models
        await human.warmup(); // Warmup
        console.log('[Worker] Human (Face) models loaded');

        // 2. Load CLIP (Scene Classification)
        const clipModel = isHighAccuracy ? 'Xenova/clip-vit-large-patch14' : 'Xenova/clip-vit-base-patch32';
        console.log(`[Worker] Using CLIP model: ${clipModel}`);
        clipPipeline = await pipeline('zero-shot-image-classification', clipModel);
        console.log('[Worker] CLIP loaded');

        isModelsLoaded = true;
        postMessage({ type: 'ready' });
    } catch (err) {
        console.error('[Worker] Failed to load models:', err);
        postMessage({ type: 'error', error: 'Failed to load models' });
    }
}

async function processImage(payload: { photoId: number, imageBitmap: ImageBitmap, profile?: string }) {
    const { photoId, imageBitmap, profile } = payload;
    const isHighAccuracy = profile === 'high';

    try {
        console.log(`[Worker] Processing photo ${photoId}`);
        const allTags = new Set<string>();
        const facesToStore: any[] = [];

        // Wrapper logic for OffscreenCanvas
        let canvas: OffscreenCanvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(imageBitmap, 0, 0);
        } else {
            throw new Error('OffscreenCanvas not supported');
        }

        // 1. Face Detection (Human)
        if (human) {
            try {
                // Human accepts OffscreenCanvas directly
                // @ts-ignore
                const result = await human.detect(canvas);

                for (const face of result.face) {
                    // Extract embedding (descriptor)
                    // Human returns 'embedding' as number[] (usually 1024-dim for some models, 192 for others)
                    // MobileFaceNet is 128? Check docs. Usually MobileFaceNet is 128 or 192.
                    // Face-api was 128. We store it as is.
                    const descriptor = face.embedding;
                    // Box: [x, y, width, height]? No, Human box is [x, y, width, height]
                    // Wait, Human box is [x, y, width, height] raw values?
                    const box = face.box; // [x, y, w, h] from docs

                    // Relaxed thresholds again (User Feedback: "Too restrictive")
                    // Balanced: 0.55, High: 0.65
                    const passesThreshold = face.score > (isHighAccuracy ? 0.65 : 0.55);

                    // Removed Rotation Check as it might be filtering out valid tilted faces.
                    // We will rely on the moderately higher confidence score (0.55 vs original 0.5) to filter junk.
                    // Extra Filter: Rotation check.
                    // False positives (like text/patterns) often have weird roll angles.
                    // We expect upright faces (since we fixed EXIF). 
                    // Allow some tilt (e.g. +/- 30 degrees = ~0.52 rad). 
                    // But if it's 90 degrees sideways, it's likely a false positive OR an artistic shot.
                    // We'll be conservative: if roll is > 45 degrees (0.78 rad) AND score is not SUPER high, skip it.
                    // if (passesThreshold && face.rotation) {
                    //     const roll = Math.abs(face.rotation.angle.roll);
                    //     // 0.78 rad is approx 45 degrees
                    //     if (roll > 0.78) {
                    //         // If it's sideways, only accept it if we are REALLY sure (> 0.85)
                    //         if (face.score < 0.85) {
                    //             passesThreshold = false;
                    //         }
                    //     }
                    // }

                    if (passesThreshold) {
                        facesToStore.push({
                            box: { x: box[0], y: box[1], width: box[2], height: box[3] },
                            descriptor
                        });
                    }
                }
            } catch (e) {
                console.error('[Worker] Human detection error:', e);
            }
        }

        // 2. Scene Classification (CLIP Multi-Pass)
        if (clipPipeline) {
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
            const reader = new FileReader();
            const dataUrlPromise = new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            });
            const dataUrl = await dataUrlPromise;

            // Pass 1 (Broad Categories)
            const broadCategories = ['nature', 'urban', 'interior', 'people', 'animals', 'objects'];
            const categoryOutput = await clipPipeline(dataUrl, broadCategories);
            const categories = Array.isArray(categoryOutput) ? categoryOutput : [categoryOutput];
            
            // Collect labels from top 2 scoring categories + always check scenes/style/mood
            const topCategories = categories
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, 2)
                .filter((p: any) => p.score > 0.15)
                .map((p: any) => p.label);
                
            const labelsToTest = new Set<string>();
            
            // Fixed base categories
            LABEL_TAXONOMY.scenes.forEach(l => labelsToTest.add(l));
            LABEL_TAXONOMY.style.forEach(l => labelsToTest.add(l));
            LABEL_TAXONOMY.mood.forEach(l => labelsToTest.add(l));
            
            // Dynamic domain categories
            for (const category of topCategories) {
                if (LABEL_TAXONOMY[category]) {
                    LABEL_TAXONOMY[category].forEach((l: string) => labelsToTest.add(l));
                }
            }
            
            // Pass 2: Fine-grained classification
            const candidateList = Array.from(labelsToTest);
            const specificOutput = await clipPipeline(dataUrl, candidateList);
            const specificScenes = Array.isArray(specificOutput) ? specificOutput : [specificOutput];
            
            specificScenes
                .filter((p: any) => p.score > 0.15) // Confidence threshold for taking the tag
                .forEach((p: any) => allTags.add(p.label));
        }

        postMessage({
            type: 'result',
            payload: {
                photoId,
                faces: facesToStore,
                tags: Array.from(allTags)
            }
        });

    } catch (err) {
        console.error(`[Worker] Error processing ${photoId}:`, err);
        postMessage({ type: 'error', error: String(err), photoId });
    } finally {
        imageBitmap.close();
    }
}
