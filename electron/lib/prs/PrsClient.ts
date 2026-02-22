import logger from '../../logger';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3847/api';
const HEALTH_URL = 'http://127.0.0.1:3847/api/health';
const POLL_INTERVAL_MS = 2_000;

export interface PrsAnalyzeRequest {
    filePath: string;
    metadata?: Record<string, unknown>;
    sourcePhotoId?: number;
}

export interface PrsRepairRequest {
    filePath: string;
    strategy: string;
    outputPath: string;
    candidateReferences?: string[];
    sourcePhotoId?: number;
}

export interface PrsJobStatus {
    jobId: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    percent?: number;
    stage?: string;
    error?: string;
    result?: {
        outputPath?: string;
        suggestedStrategies?: Array<{ strategy: string; score: number }>;
        [key: string]: unknown;
    };
}

export class PrsApiError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly body: unknown,
    ) {
        super(message);
        this.name = 'PrsApiError';
    }
}

export class PrsClient {
    private readonly token: string;
    private readonly baseUrl: string;

    constructor(token: string, baseUrl = DEFAULT_BASE_URL) {
        this.token = token;
        this.baseUrl = baseUrl;
    }

    /** Unauthenticated health check — returns true if PRS is up */
    async checkHealth(): Promise<boolean> {
        try {
            const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3_000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    /** Submit a file for analysis. Returns the jobId. */
    async analyze(req: PrsAnalyzeRequest): Promise<{ jobId: string }> {
        return this.request<{ jobId: string }>('POST', '/analyze', req);
    }

    /** Submit a repair job. Returns the jobId. */
    async repair(req: PrsRepairRequest): Promise<{ jobId: string }> {
        return this.request<{ jobId: string }>('POST', '/repair', req);
    }

    /** Fetch the current status of a job. */
    async getStatus(jobId: string): Promise<PrsJobStatus> {
        return this.request<PrsJobStatus>('GET', `/status/${encodeURIComponent(jobId)}`);
    }

    /**
     * Poll until the job reaches a terminal state or times out.
     * Resolves with the final status on success, rejects on failure or timeout.
     */
    async pollUntilDone(
        jobId: string,
        onProgress: (status: PrsJobStatus) => void = () => {},
        timeoutMs = 300_000,
    ): Promise<PrsJobStatus> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const status = await this.getStatus(jobId);
            onProgress(status);

            if (status.status === 'done') return status;
            if (status.status === 'failed') {
                throw new PrsApiError(
                    `PRS job ${jobId} failed: ${status.error ?? 'unknown error'}`,
                    0,
                    status,
                );
            }

            await sleep(POLL_INTERVAL_MS);
        }

        throw new PrsApiError(`PRS job ${jobId} timed out after ${timeoutMs}ms`, 0, null);
    }

    private async request<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
        const url = `${this.baseUrl}${urlPath}`;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };

        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
            let responseBody: unknown;
            try {
                responseBody = await res.json();
            } catch {
                responseBody = await res.text();
            }
            logger.warn({ statusCode: res.status, path: urlPath }, '[PrsClient] Non-2xx response');
            throw new PrsApiError(`PRS API error ${res.status} on ${method} ${urlPath}`, res.status, responseBody);
        }

        return res.json() as Promise<T>;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
