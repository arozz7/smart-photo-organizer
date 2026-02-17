export interface ExportableError {
    filePath: string;
    errorType: string;
    errorMessage: string;
    scanType: string;
    timestamp: string;
}

/**
 * Export scan errors to CSV file with RFC 4180 compliant formatting.
 * 
 * @param errors - Array of error records to export
 * @param filename - Output filename (without extension)
 */
export function exportErrorsToCsv(errors: ExportableError[], filename: string): void {
    if (!errors || errors.length === 0) {
        console.warn('[exportUtils] No errors to export');
        return;
    }

    // CSV Headers
    const headers = ['File Path', 'Error Type', 'Error Message', 'Scan Type', 'Timestamp'];

    // Helper: Escape CSV field (RFC 4180)
    const escapeField = (field: string): string => {
        if (!field) return '';
        // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
        if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    };

    // Build CSV content
    const rows = [
        headers.join(','),
        ...errors.map(err => [
            escapeField(err.filePath),
            escapeField(err.errorType),
            escapeField(err.errorMessage),
            escapeField(err.scanType),
            escapeField(err.timestamp)
        ].join(','))
    ];

    const csvContent = rows.join('\n');

    // Trigger browser download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[exportUtils] Exported ${errors.length} errors to ${filename}.csv`);
}
