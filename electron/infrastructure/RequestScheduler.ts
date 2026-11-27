/**
 * Decides when a request is written to the Python engine. The engine reads one command at a time, in the order it receives them, and cannot be
 * interrupted. Background work (captions, face checks, grouping batches) therefore kept the engine busy and a request the user was waiting for
 * (opening a page, the AI status) stood in line behind it: 47 seconds in the log of 2026-11-26.
 *
 * Two lanes:
 *  - foreground (the default): written at once.
 *  - background: written only while no foreground request is waiting for its answer, and one at a time. A user request then waits for at most
 *    the one background command already running.
 *
 * A request's timeout counts from the moment it is written, not from when it was queued: a request held back for minutes must not time out
 * before it ran (a timed-out face check was accepted as "human" without ever being checked).
 */

export type Lane = 'foreground' | 'background';

export interface SchedulerTimers {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface ScheduledJob {
    lane: Lane;
    timeoutMs: number;
    /** Writes the request to the engine. */
    start(): void;
    /** Called when no answer came within `timeoutMs` after `start`. The place is released first. */
    onTimeout(): void;
}

export interface ScheduledHandle {
    /** The answer came (or the request was given up). Releases the place; safe to call more than once. */
    finish(): void;
}

const realTimers: SchedulerTimers = {
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry {
    job: ScheduledJob;
    running: boolean;
    done: boolean;
    timer?: unknown;
}

export class RequestScheduler {
    private foregroundRunning = 0;
    private backgroundRunning = 0;
    private readonly waiting: Entry[] = [];
    private readonly running = new Set<Entry>();

    constructor(private readonly timers: SchedulerTimers = realTimers) {}

    schedule(job: ScheduledJob): ScheduledHandle {
        const entry: Entry = { job, running: false, done: false };
        if (job.lane === 'foreground') this.begin(entry);
        else {
            this.waiting.push(entry);
            this.startWaiting();
        }
        return { finish: () => this.release(entry) };
    }

    /** The engine restarted or stopped: nothing queued or running counts any more, and no timeout fires. */
    reset(): void {
        for (const entry of this.running) this.stopTimer(entry);
        this.running.clear();
        this.waiting.length = 0;
        this.foregroundRunning = 0;
        this.backgroundRunning = 0;
    }

    private begin(entry: Entry): void {
        entry.running = true;
        this.running.add(entry);
        if (entry.job.lane === 'foreground') this.foregroundRunning++;
        else this.backgroundRunning++;
        try {
            entry.job.start();
        } catch (error) {
            this.release(entry);
            throw error;
        }
        if (!entry.done) entry.timer = this.timers.setTimeout(() => this.timeOut(entry), entry.job.timeoutMs);
    }

    private timeOut(entry: Entry): void {
        if (entry.done) return;
        this.release(entry);
        entry.job.onTimeout();
    }

    private release(entry: Entry): void {
        if (entry.done) return;
        entry.done = true;
        this.stopTimer(entry);
        const queuedAt = this.waiting.indexOf(entry);
        if (queuedAt >= 0) this.waiting.splice(queuedAt, 1);
        if (entry.running) {
            this.running.delete(entry);
            if (entry.job.lane === 'foreground') this.foregroundRunning--;
            else this.backgroundRunning--;
        }
        this.startWaiting();
    }

    private startWaiting(): void {
        while (this.foregroundRunning === 0 && this.backgroundRunning === 0 && this.waiting.length > 0) {
            const next = this.waiting.shift() as Entry;
            try {
                this.begin(next);
            } catch {
                // Its start threw: the place is already released; the next waiting request gets its turn.
            }
        }
    }

    private stopTimer(entry: Entry): void {
        if (entry.timer !== undefined) this.timers.clearTimeout(entry.timer);
        entry.timer = undefined;
    }
}
