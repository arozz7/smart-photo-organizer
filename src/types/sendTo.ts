/** Shapes exchanged with the main process for "Send to..." (mirrors electron/core/services/sendTo). */

export type SendSource =
    | { kind: 'photos'; ids: number[] }
    | { kind: 'smartAlbum'; albumId: number };

export interface SendCounts {
    requested: number;
    missing: number;
    sent: number;
    tooLong?: number;
}

export type SendFailureReason =
    | 'not_configured'
    | 'launch_failed'
    | 'unknown_target'
    | 'unknown_source'
    | 'nothing_to_send'
    | 'invalid_request';

export type SendOutcome =
    | { status: 'sent'; counts: SendCounts; batches: number }
    | { status: 'needs_confirmation'; counts: SendCounts; sendable: number; threshold: number }
    | { status: 'failed'; reason: SendFailureReason; counts: SendCounts };

export interface SendTargetInfo {
    id: string;
    label: string;
}

export interface SendToSettingsView {
    confirmThreshold: number;
    /** Empty means "use the default install location". */
    clearFrameExecutablePath: string;
}
