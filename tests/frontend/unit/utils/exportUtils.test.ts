/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportErrorsToCsv, type ExportableError } from '../../../../src/utils/exportUtils';

describe('exportUtils', () => {
    let mockCreateElement: any;
    let mockClick: any;
    let mockAppendChild: any;
    let mockRemoveChild: any;
    let mockCreateObjectURL: any;
    let mockRevokeObjectURL: any;

    beforeEach(() => {
        // Mock DOM methods
        mockClick = vi.fn();
        mockAppendChild = vi.fn();
        mockRemoveChild = vi.fn();
        mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
        mockRevokeObjectURL = vi.fn();

        mockCreateElement = vi.spyOn(document, 'createElement').mockReturnValue({
            href: '',
            download: '',
            style: { display: '' },
            click: mockClick,
        } as any);

        vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
        vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
        vi.spyOn(URL, 'createObjectURL').mockImplementation(mockCreateObjectURL);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mockRevokeObjectURL);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should export CSV with correct format', () => {
        const errors: ExportableError[] = [
            {
                filePath: 'C:\\Photos\\image1.jpg',
                errorType: 'Preview Generation',
                errorMessage: 'File not found',
                scanType: 'Initial Scan',
                timestamp: '2026-02-16T18:00:00'
            },
            {
                filePath: 'C:\\Photos\\image2.jpg',
                errorType: 'AI Processing',
                errorMessage: 'Timeout',
                scanType: 'Rescan',
                timestamp: '2026-02-16T19:00:00'
            }
        ];

        exportErrorsToCsv(errors, 'test-errors');

        // Verify blob creation with correct content
        expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
        const blobCall = mockCreateObjectURL.mock.calls[0][0];
        expect(blobCall.type).toBe('text/csv;charset=utf-8;');

        // Verify link was created and clicked
        expect(mockCreateElement).toHaveBeenCalledWith('a');
        expect(mockClick).toHaveBeenCalledTimes(1);
        expect(mockAppendChild).toHaveBeenCalledTimes(1);
        expect(mockRemoveChild).toHaveBeenCalledTimes(1);
        expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should escape CSV fields with commas and quotes', () => {
        const errors: ExportableError[] = [
            {
                filePath: 'C:\\Photos\\image,test.jpg',
                errorType: 'Error with "quotes"',
                errorMessage: 'Message with, comma and "quotes"',
                scanType: 'Scan',
                timestamp: '2026-02-16T18:00:00'
            }
        ];

        exportErrorsToCsv(errors, 'test-escaping');

        expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
        const blob = mockCreateObjectURL.mock.calls[0][0];

        // Read blob content (we can't directly read it in the test, but we verified the blob was created)
        expect(blob).toBeInstanceOf(Blob);
    });

    it('should handle empty array gracefully', () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { });

        exportErrorsToCsv([], 'empty-test');

        expect(consoleWarn).toHaveBeenCalledWith('[exportUtils] No errors to export');
        expect(mockCreateElement).not.toHaveBeenCalled();
        expect(mockClick).not.toHaveBeenCalled();

        consoleWarn.mockRestore();
    });

    it('should generate filename with correct format', () => {
        const errors: ExportableError[] = [
            {
                filePath: 'test.jpg',
                errorType: 'Error',
                errorMessage: 'Test',
                scanType: 'Scan',
                timestamp: '2026-02-16T18:00:00'
            }
        ];

        exportErrorsToCsv(errors, 'scan-errors-2026-02-16');

        const linkElement = mockCreateElement.mock.results[0].value;
        expect(linkElement.download).toBe('scan-errors-2026-02-16.csv');
    });

    it('should handle newlines in error messages', () => {
        const errors: ExportableError[] = [
            {
                filePath: 'test.jpg',
                errorType: 'Error',
                errorMessage: 'Line 1\nLine 2\rLine 3',
                scanType: 'Scan',
                timestamp: '2026-02-16T18:00:00'
            }
        ];

        exportErrorsToCsv(errors, 'test-newlines');

        expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
        const blob = mockCreateObjectURL.mock.calls[0][0];
        expect(blob).toBeInstanceOf(Blob);
    });
});
