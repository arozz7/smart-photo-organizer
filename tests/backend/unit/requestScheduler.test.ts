import { describe, it, expect, vi } from 'vitest';
import { RequestScheduler, type Lane, type SchedulerTimers } from '../../../electron/infrastructure/RequestScheduler';

/** Timers the test moves by hand: no waiting, nothing real. */
function manualTimers() {
    let now = 0;
    let nextHandle = 1;
    const pending = new Map<number, { at: number; run: () => void }>();
    const timers: SchedulerTimers = {
        setTimeout: (run, ms) => { const handle = nextHandle++; pending.set(handle, { at: now + ms, run }); return handle; },
        clearTimeout: handle => { pending.delete(handle as number); },
    };
    const advance = (ms: number) => {
        now += ms;
        for (const [handle, timer] of [...pending]) {
            if (timer.at <= now) { pending.delete(handle); timer.run(); }
        }
    };
    return { timers, advance, pendingTimers: () => pending.size };
}

function setup() {
    const clock = manualTimers();
    const scheduler = new RequestScheduler(clock.timers);
    const started: string[] = [];
    const timedOut: string[] = [];
    const submit = (name: string, lane: Lane, timeoutMs = 1000) =>
        scheduler.schedule({ lane, timeoutMs, start: () => started.push(name), onTimeout: () => timedOut.push(name) });
    return { scheduler, started, timedOut, submit, ...clock };
}

describe('RequestScheduler', () => {
    it('starts a foreground request at once', () => {
        const { submit, started } = setup();

        submit('user', 'foreground');

        expect(started).toEqual(['user']);
    });

    it('starts a background request at once when nothing else is running', () => {
        const { submit, started } = setup();

        submit('caption', 'background');

        expect(started).toEqual(['caption']);
    });

    it('holds background requests while a foreground request is running, then starts them in order', () => {
        const { submit, started } = setup();
        const user = submit('user', 'foreground');
        submit('caption-1', 'background');
        submit('caption-2', 'background');
        expect(started).toEqual(['user']);

        user.finish();

        expect(started).toEqual(['user', 'caption-1']);
    });

    it('runs one background request at a time, so a user request never waits behind more than one', () => {
        const { submit, started } = setup();
        const first = submit('caption-1', 'background');
        submit('caption-2', 'background');
        submit('caption-3', 'background');
        expect(started).toEqual(['caption-1']);

        first.finish();

        expect(started).toEqual(['caption-1', 'caption-2']);
    });

    it('starts a foreground request at once even while a background request is running', () => {
        const { submit, started } = setup();
        submit('caption', 'background');

        submit('user', 'foreground');

        expect(started).toEqual(['caption', 'user']);
    });

    it('keeps queued background requests waiting until every foreground request is done', () => {
        const { submit, started } = setup();
        const first = submit('user-1', 'foreground');
        const second = submit('user-2', 'foreground');
        submit('caption', 'background');

        first.finish();
        expect(started).toEqual(['user-1', 'user-2']);
        second.finish();

        expect(started).toEqual(['user-1', 'user-2', 'caption']);
    });

    it('starts foreground requests in the order they came', () => {
        const { submit, started } = setup();

        submit('a', 'foreground');
        submit('b', 'foreground');
        submit('c', 'foreground');

        expect(started).toEqual(['a', 'b', 'c']);
    });

    describe('timeouts', () => {
        it('count from the moment a request starts, not from when it was queued', () => {
            const { submit, advance, started, timedOut } = setup();
            const user = submit('user', 'foreground', 100_000);
            submit('caption', 'background', 500);

            advance(50_000); // the caption has now waited far longer than its own limit
            expect(timedOut).toEqual([]);
            user.finish();
            expect(started).toEqual(['user', 'caption']);
            advance(499);
            expect(timedOut).toEqual([]);
            advance(1);

            expect(timedOut).toEqual(['caption']);
        });

        it('free the place of a request that timed out, so the next one can start', () => {
            const { submit, advance, started, timedOut } = setup();
            submit('caption-1', 'background', 500);
            submit('caption-2', 'background', 500);

            advance(500);

            expect(timedOut).toEqual(['caption-1']);
            expect(started).toEqual(['caption-1', 'caption-2']);
        });

        it('do not fire for a request that finished in time', () => {
            const { submit, advance, timedOut, pendingTimers } = setup();
            const user = submit('user', 'foreground', 500);

            user.finish();
            advance(10_000);

            expect(timedOut).toEqual([]);
            expect(pendingTimers()).toBe(0);
        });
    });

    it('releases a place only once, however often finish is called (a late answer after a timeout)', () => {
        const { submit, advance, started } = setup();
        const first = submit('caption-1', 'background', 500);
        submit('caption-2', 'background', 500);
        submit('caption-3', 'background', 500);
        advance(500); // caption-1 timed out, caption-2 started

        first.finish(); // the late answer of caption-1 arrives
        first.finish();

        expect(started).toEqual(['caption-1', 'caption-2']);
    });

    it('forgets everything queued or running when the engine is reset, without calling any timeout', () => {
        const { scheduler, submit, advance, started, timedOut, pendingTimers } = setup();
        submit('user', 'foreground');
        submit('caption', 'background');

        scheduler.reset();
        advance(10_000);

        expect(timedOut).toEqual([]);
        expect(pendingTimers()).toBe(0);
        submit('after', 'background');
        expect(started).toEqual(['user', 'after']);
    });

    it('a request whose start throws does not hold its place', () => {
        const clock = manualTimers();
        const scheduler = new RequestScheduler(clock.timers);
        const started: string[] = [];
        const failing = vi.fn(() => { throw new Error('write failed'); });

        expect(() => scheduler.schedule({ lane: 'foreground', timeoutMs: 1000, start: failing, onTimeout: vi.fn() })).toThrow('write failed');
        scheduler.schedule({ lane: 'background', timeoutMs: 1000, start: () => started.push('caption'), onTimeout: vi.fn() });

        expect(started).toEqual(['caption']);
    });
});
