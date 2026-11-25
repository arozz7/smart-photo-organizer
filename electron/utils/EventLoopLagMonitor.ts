/**
 * Finds out when the main process freezes. A timer that should fire every `tickMs` fires late when something blocks the
 * event loop (a long synchronous database write, heavy file work); the lateness is the time the app could not answer the window.
 * Delays above the threshold are collected and reported once per window with what the app was doing, so a scan that makes
 * the window stall leaves one log line per 10 seconds that names the cause instead of nothing.
 * It measures only; it changes no behavior.
 */

export interface LagSummary {
    /** Number of delays above the threshold in the window. */
    count: number;
    maxMs: number;
    totalMs: number;
    /** The distinct activity labels seen when delays happened, joined with " | ". */
    activity: string;
}

/** What the monitor needs from outside, so it can be tested without a real clock. */
export interface LagMonitorIO {
    now(): number;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface LagMonitorOptions {
    report: (summary: LagSummary) => void;
    /** A short label for what the app is doing now (for example "scan, 2 image jobs"). */
    activity: () => string;
    tickMs?: number;
    thresholdMs?: number;
    windowMs?: number;
    io?: LagMonitorIO;
}

const realIO: LagMonitorIO = {
    now: () => Date.now(),
    setInterval: (callback, ms) => {
        const handle = setInterval(callback, ms);
        handle.unref();
        return handle;
    },
    clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class EventLoopLagMonitor {
    private readonly tickMs: number;
    private readonly thresholdMs: number;
    private readonly windowMs: number;
    private readonly io: LagMonitorIO;
    private handle: unknown = null;
    private lastTick = 0;
    private windowStart = 0;
    private count = 0;
    private maxMs = 0;
    private totalMs = 0;
    private activities = new Set<string>();

    constructor(private readonly options: LagMonitorOptions) {
        this.tickMs = options.tickMs ?? 100;
        this.thresholdMs = options.thresholdMs ?? 200;
        this.windowMs = options.windowMs ?? 10_000;
        this.io = options.io ?? realIO;
    }

    start(): void {
        if (this.handle !== null) return;
        this.lastTick = this.windowStart = this.io.now();
        this.handle = this.io.setInterval(() => this.tick(), this.tickMs);
    }

    stop(): void {
        if (this.handle === null) return;
        this.io.clearInterval(this.handle);
        this.handle = null;
    }

    private tick(): void {
        const now = this.io.now();
        const lateByMs = now - this.lastTick - this.tickMs;
        this.lastTick = now;

        if (lateByMs >= this.thresholdMs) {
            this.count++;
            this.totalMs += lateByMs;
            this.maxMs = Math.max(this.maxMs, lateByMs);
            this.activities.add(this.options.activity());
        }

        if (now - this.windowStart >= this.windowMs) this.closeWindow(now);
    }

    private closeWindow(now: number): void {
        if (this.count > 0) {
            this.options.report({ count: this.count, maxMs: this.maxMs, totalMs: this.totalMs, activity: [...this.activities].join(' | ') });
        }
        this.windowStart = now;
        this.count = this.maxMs = this.totalMs = 0;
        this.activities.clear();
    }
}
