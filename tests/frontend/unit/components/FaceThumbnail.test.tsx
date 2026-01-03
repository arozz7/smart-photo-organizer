/**
 * @vitest-environment happy-dom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import FaceThumbnail from '../../../../src/components/FaceThumbnail';

describe('FaceThumbnail', () => {
    it('should generate correct URL with server crop and original width', () => {
        const box = { x: 10, y: 20, width: 30, height: 40 };
        render(
            <FaceThumbnail
                src="local-resource://photo.jpg"
                box={box}
                originalImageWidth={100}
                useServerCrop={true}
            />
        );

        const img = screen.getByRole('img');
        const url = img.getAttribute('src');

        expect(url).toContain('photo.jpg');
        expect(url).toContain('box=10,20,30,40');
        expect(url).toContain('originalWidth=100');
        expect(url).toContain('silent_404=true');
        expect(url).toContain('width=300'); // Default cap in component
    });

    it('should show loading pulse initially', () => {
        render(<FaceThumbnail src="local-resource://photo.jpg" />);
        expect(screen.getByRole('img').parentElement?.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('should handle fallback source on error', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        render(
            <FaceThumbnail
                src="invalid.jpg"
                fallbackSrc="fallback.jpg"
            />
        );

        const img = screen.getByRole('img');

        // Simulate error
        fireEvent.error(img);

        // Should switch src to fallback
        expect(img.getAttribute('src')).toContain('fallback.jpg');
        consoleSpy.mockRestore();
    });

    it('should calculate CSS cropping when not using server crop', () => {
        const box = { x: 10, y: 20, width: 20, height: 20 };
        render(
            <FaceThumbnail
                src="local-resource://photo.jpg"
                box={box}
                originalImageWidth={100}
                useServerCrop={false}
            />
        );

        const img = screen.getByRole('img') as HTMLImageElement;

        // Mock naturalWidth to simulate image load
        Object.defineProperty(img, 'naturalWidth', { value: 100 });

        // Trigger load
        fireEvent.load(img);

        const style = img.style;
        // Calculation logic in FaceThumbnail:
        // scale = naturalW / originalW = 100 / 100 = 1
        // rectW = box.width * scale = 20 * 1 = 20
        // newWidthPct = (naturalW / rectW) * 100 = (100 / 20) * 100 = 500%
        // newMarginLeft = -(rectX / rectW) * 100 = -(10/20) * 100 = -50%

        expect(style.width).toBe('500%');
        expect(style.marginLeft).toBe('-50%');
        expect(style.marginTop).toBe('-100%'); // -(20/20) * 100
        expect(style.opacity).toBe('1');
    });
});
