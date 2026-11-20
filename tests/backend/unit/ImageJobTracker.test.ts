import { describe, it, expect } from 'vitest';
import { ImageJobTracker, MAX_PARALLEL_IMAGE_JOBS, type TrackerIO } from '../../../electron/services/image/ImageJobTracker';

/** An in-memory file and a timer the test fires by hand. */
function fakeIO() {
    const files = new Map<string, string>();
    const timers: (() => void)[] = [];
    const io: TrackerIO = {
        write: (file, text) => { files.set(file, text); },
        read: file => files.get(file) ?? null,
        setTimer: fn => { timers.push(fn); return timers.length; },
        now: () => Date.parse('2026-11-20T18:00:00Z'),
    };
    const fire = () => { const due = timers.splice(0); due.forEach(fn => fn()); };
    return { io, files, fire, pending: () => timers.length };
}

/** A job that runs until the test releases it. */
function gate() {
    let release: (value?: unknown) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const promise = new Promise((resolve, reject) => { release = resolve; fail = reject; });
    return { promise, release, fail };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const saved = (files: Map<string, string>, file: string) => JSON.parse(files.get(file) ?? '{}') as { jobs: { op: string; file: string }[] };

describe('ImageJobTracker', () => {
    describe('limit', () => {
        it('runs at most the allowed number of jobs at once and starts the next when one finishes', async () => {
            const { io } = fakeIO();
            const tracker = new ImageJobTracker(io, 2);
            const gates = [gate(), gate(), gate()];
            const started: number[] = [];

            const runs = gates.map((g, i) => tracker.run('thumbnail', `f${i}.jpg`, async () => { started.push(i); await g.promise; return i; }));
            await flush();
            expect(started).toEqual([0, 1]);
            expect(tracker.inFlight().map(job => job.file)).toEqual(['f0.jpg', 'f1.jpg']);

            gates[0].release();
            await flush();
            expect(started).toEqual([0, 1, 2]);

            gates[1].release();
            gates[2].release();
            expect(await Promise.all(runs)).toEqual([0, 1, 2]);
            expect(tracker.inFlight()).toEqual([]);
        });

        it('allows 4 at once by default', () => {
            expect(MAX_PARALLEL_IMAGE_JOBS).toBe(4);
        });

        it('frees the slot when a job fails, and passes the failure on', async () => {
            const { io } = fakeIO();
            const tracker = new ImageJobTracker(io, 1);
            const g = gate();
            const first = tracker.run('preview', 'a.jpg', () => g.promise);
            const second = tracker.run('preview', 'b.jpg', async () => 'ok');
            await flush();

            g.fail(new Error('unsupported image format'));

            await expect(first).rejects.toThrow('unsupported image format');
            await expect(second).resolves.toBe('ok');
            expect(tracker.inFlight()).toEqual([]);
        });
    });

    describe('breadcrumb', () => {
        it('writes the files being processed to the state file (after a short delay, not on every change)', async () => {
            const { io, files, fire, pending } = fakeIO();
            const tracker = new ImageJobTracker(io, 4);
            tracker.attachStateFile('state.json');
            const g = gate();

            const run = tracker.run('thumbnail', 'R:\\Pictures\\a.ARW', () => g.promise);
            await flush();
            tracker.run('preview', 'b.jpg', () => g.promise).catch(() => undefined);
            await flush();
            expect(pending()).toBe(1);

            fire();
            expect(saved(files, 'state.json').jobs.map(job => [job.op, job.file])).toEqual([['thumbnail', 'R:\\Pictures\\a.ARW'], ['preview', 'b.jpg']]);

            g.release();
            await run;
            fire();
            expect(saved(files, 'state.json').jobs).toEqual([]);
        });

        it('hands back what the previous session left in flight, which means it ended in the middle of those jobs', () => {
            const { io, files } = fakeIO();
            files.set('state.json', JSON.stringify({ at: '2026-11-20T18:23:06Z', jobs: [{ op: 'thumbnail', file: 'x.ARW', since: '2026-11-20T18:23:06Z' }] }));
            const tracker = new ImageJobTracker(io, 4);

            const previous = tracker.attachStateFile('state.json');

            expect(previous).toEqual([{ op: 'thumbnail', file: 'x.ARW', since: '2026-11-20T18:23:06Z' }]);
            expect(saved(files, 'state.json').jobs).toEqual([]);
        });

        it('has nothing to report on a first run, after a clean exit, or when the file is unreadable', () => {
            const { io, files } = fakeIO();
            expect(new ImageJobTracker(io, 4).attachStateFile('state.json')).toEqual([]);

            files.set('state.json', JSON.stringify({ at: 'x', jobs: [] }));
            expect(new ImageJobTracker(io, 4).attachStateFile('state.json')).toEqual([]);

            files.set('state.json', '{not json');
            expect(new ImageJobTracker(io, 4).attachStateFile('state.json')).toEqual([]);
        });

        it('marks a clean exit, so jobs still running at quit are not reported as a crash', async () => {
            const { io, files, fire } = fakeIO();
            const tracker = new ImageJobTracker(io, 4);
            tracker.attachStateFile('state.json');
            tracker.run('thumbnail', 'a.jpg', () => gate().promise).catch(() => undefined);
            await flush();
            fire();
            expect(saved(files, 'state.json').jobs).toHaveLength(1);

            tracker.markCleanShutdown();

            expect(saved(files, 'state.json').jobs).toEqual([]);
        });

        it('keeps working when the state file cannot be written', async () => {
            const { io, fire } = fakeIO();
            io.write = () => { throw new Error('disk full'); };
            const tracker = new ImageJobTracker(io, 4);
            tracker.attachStateFile('state.json');

            const result = await tracker.run('thumbnail', 'a.jpg', async () => 'fine');
            expect(() => fire()).not.toThrow();

            expect(result).toBe('fine');
        });

        it('writes nothing until a state file is attached', async () => {
            const { io, files, fire } = fakeIO();
            const tracker = new ImageJobTracker(io, 4);

            await tracker.run('thumbnail', 'a.jpg', async () => 1);
            fire();

            expect(files.size).toBe(0);
        });
    });
});
