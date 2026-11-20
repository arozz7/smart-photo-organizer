import fs from 'node:fs';

/**
 * Native image work (sharp / libvips) can end the whole app with no JavaScript error and no trace of the file involved
 * (0.8.11 and 0.8.13 each died inside the sharp module while thumbnails and previews were being made).
 * This does two things for that work:
 *  - it limits how many sharp jobs run at the same time, and
 *  - it keeps a small file listing the jobs in flight, so after a crash the next start can say which files were being processed.
 * The limit is a stability measure, not a proven fix.
 */

/** Sharp jobs allowed at once; the rest wait their turn. */
export const MAX_PARALLEL_IMAGE_JOBS = 4;
/** Threads libvips may use inside one job (the sharp default is the number of CPU cores). */
export const SHARP_THREADS_PER_JOB = 2;
const FLUSH_MS = 200;

export interface ImageJob {
    op: string;
    file: string;
    since: string;
}

/** What the tracker needs from outside, so it can be tested without a disk or a clock. */
export interface TrackerIO {
    write(file: string, text: string): void;
    read(file: string): string | null;
    setTimer(callback: () => void, ms: number): unknown;
    now(): number;
}

const realIO: TrackerIO = {
    write: (file, text) => fs.writeFileSync(file, text),
    read: file => {
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return null;
        }
    },
    setTimer: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        timer.unref();
        return timer;
    },
    now: () => Date.now(),
};

export class ImageJobTracker {
    private readonly running = new Map<number, ImageJob>();
    private readonly waiting: (() => void)[] = [];
    private active = 0;
    private nextId = 0;
    private timerSet = false;
    private stateFile: string | null = null;

    constructor(
        private readonly io: TrackerIO = realIO,
        private readonly maxParallel: number = MAX_PARALLEL_IMAGE_JOBS,
    ) {}

    /**
     * Starts keeping the in-flight list in `file`. Returns the jobs the previous session left in it (a session that ended
     * cleanly leaves none), then clears it.
     */
    attachStateFile(file: string): ImageJob[] {
        this.stateFile = file;
        const previous = this.readPrevious(file);
        this.flushNow();
        return previous;
    }

    private readPrevious(file: string): ImageJob[] {
        const text = this.io.read(file);
        if (!text) return [];
        try {
            const parsed = JSON.parse(text) as { jobs?: ImageJob[] };
            return Array.isArray(parsed.jobs) ? parsed.jobs : [];
        } catch {
            return [];
        }
    }

    inFlight(): ImageJob[] {
        return [...this.running.values()];
    }

    /** Runs `job` when a slot is free, and records `file` as in flight while it runs. */
    async run<T>(op: string, file: string, job: () => Promise<T>): Promise<T> {
        await this.acquire();
        const id = ++this.nextId;
        this.running.set(id, { op, file, since: new Date(this.io.now()).toISOString() });
        this.scheduleFlush();
        try {
            return await job();
        } finally {
            this.running.delete(id);
            this.release();
            this.scheduleFlush();
        }
    }

    /** Called when the app is quitting on purpose: jobs still running then are not a sign of a crash. */
    markCleanShutdown(): void {
        this.writeState([]);
        this.stateFile = null;
    }

    private acquire(): Promise<void> {
        if (this.active < this.maxParallel) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => this.waiting.push(resolve));
    }

    private release(): void {
        const next = this.waiting.shift();
        if (next) next(); // the slot passes straight on
        else this.active--;
    }

    private scheduleFlush(): void {
        if (!this.stateFile || this.timerSet) return;
        this.timerSet = true;
        this.io.setTimer(() => {
            this.timerSet = false;
            this.flushNow();
        }, FLUSH_MS);
    }

    private flushNow(): void {
        if (this.stateFile) this.writeState(this.inFlight());
    }

    private writeState(jobs: ImageJob[]): void {
        if (!this.stateFile) return;
        try {
            this.io.write(this.stateFile, JSON.stringify({ at: new Date(this.io.now()).toISOString(), jobs }));
        } catch {
            /* the breadcrumb is a convenience: never let it break image work */
        }
    }
}

/** The one tracker of the app. */
export const imageJobs = new ImageJobTracker();
