export interface PrsAvailability {
    available: boolean;
    version?: string;
}

export type RepairStatus =
    | 'idle'
    | 'checking_prs'
    | 'prs_unavailable'
    | 'analyzing'
    | 'repairing'
    | 'verifying'
    | 'done'
    | 'failed'
    | 'unrepairable';

export interface RepairState {
    status: RepairStatus;
    jobId?: string;
    percent?: number;
    stage?: string;
    error?: string;
    repairedFilePath?: string;
}

export interface PrsJobResult {
    jobId: string;
    status: 'done' | 'failed';
    percent?: number;
    stage?: string;
    error?: string;
    result?: {
        outputPath?: string;
        suggestedStrategies?: Array<{ strategy: string; score: number }>;
        [key: string]: unknown;
    };
}
