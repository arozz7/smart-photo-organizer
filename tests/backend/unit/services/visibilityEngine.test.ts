import { describe, it, expect, vi } from 'vitest';
import { scoreWithEngine, pickImagePath } from '../../../../electron/core/services/visibilityEngine';
import type { VisibilityFace } from '../../../../electron/core/services/FaceVisibilityService';

const face = (id: number, extra: Partial<VisibilityFace> = {}): VisibilityFace => ({
    id, imagePath: `p${id}.jpg`, photoWidth: 4000, box: { x: 1, y: 2, width: 3, height: 4 }, ...extra,
});

describe('scoreWithEngine', () => {
    it('sends the faces as items and returns the engine results', async () => {
        const send = vi.fn().mockResolvedValue({ success: true, results: [{ faceId: 1, score: 2.5 }, { faceId: 2, score: null, error: 'could not open' }] });

        const results = await scoreWithEngine([face(1), face(2)], send);

        expect(send).toHaveBeenCalledWith(
            'score_face_visibility',
            { items: [
                { faceId: 1, imagePath: 'p1.jpg', box: { x: 1, y: 2, width: 3, height: 4 }, photoWidth: 4000 },
                { faceId: 2, imagePath: 'p2.jpg', box: { x: 1, y: 2, width: 3, height: 4 }, photoWidth: 4000 },
            ] },
            expect.any(Number),
        );
        expect(results).toEqual([{ faceId: 1, score: 2.5 }, { faceId: 2, score: null, error: 'could not open' }]);
    });

    it('can ask another command (the picture check)', async () => {
        const send = vi.fn().mockResolvedValue({ success: true, results: [{ faceId: 1, score: -2 }] });

        const results = await scoreWithEngine([face(1)], send, 'score_face_picture');

        expect(send).toHaveBeenCalledWith('score_face_picture', expect.any(Object), expect.any(Number));
        expect(results).toEqual([{ faceId: 1, score: -2 }]);
    });

    it('allows a long first call (the model has to load)', async () => {
        const send = vi.fn().mockResolvedValue({ success: true, results: [] });

        await scoreWithEngine([face(1)], send);

        expect(send.mock.calls[0][2]).toBeGreaterThanOrEqual(60_000);
    });

    it.each([
        [{ success: false, error: 'A GPU is required for this check' }, 'A GPU is required for this check'],
        [{ error: 'engine busy' }, 'engine busy'],
        [{ success: true }, 'invalid'],
        [{ success: true, results: 'nope' }, 'invalid'],
        [{ success: true, results: [{ faceId: 'x', score: 1 }] }, 'invalid'],
        [{ success: true, results: [{ faceId: 1, score: 'high' }] }, 'invalid'],
        [{ success: true, results: [{ faceId: 1, score: Number.POSITIVE_INFINITY }] }, 'invalid'],
        [null, 'invalid'],
    ])('throws for the reply %j', async (reply, message) => {
        const send = vi.fn().mockResolvedValue(reply);

        await expect(scoreWithEngine([face(1)], send)).rejects.toThrow(message);
    });

    it('lets a failed request (timeout, engine down) through as an error', async () => {
        const send = vi.fn().mockRejectedValue(new Error('Request timed out'));

        await expect(scoreWithEngine([face(1)], send)).rejects.toThrow('Request timed out');
    });

    it('does not call the engine for no faces', async () => {
        const send = vi.fn();

        expect(await scoreWithEngine([], send)).toEqual([]);
        expect(send).not.toHaveBeenCalled();
    });
});

describe('pickImagePath', () => {
    it('prefers the preview when it is on disk', () => {
        expect(pickImagePath('prev.jpg', 'orig.jpg', () => true)).toBe('prev.jpg');
    });

    it('falls back to the photo when the preview is missing or not set', () => {
        expect(pickImagePath('prev.jpg', 'orig.jpg', () => false)).toBe('orig.jpg');
        expect(pickImagePath(null, 'orig.jpg', () => true)).toBe('orig.jpg');
    });

    it('is null when there is no image at all', () => {
        expect(pickImagePath(null, null, () => true)).toBeNull();
    });
});
