import { describe, it, expect } from 'vitest';
import { BackgroundLoop, type Sleep } from '../../../../electron/core/services/BackgroundLoop';

/** A sleep that records what it was asked for and gives other work a turn instead of waiting, so no real time passes. */
function fakeSleep() {
    const waits: number[] = [];
    const sleep: Sleep = async (ms, onWake) => {
        waits.push(ms);
        onWake(() => undefined);
        await new Promise(resolve => setImmediate(resolve));
    };
    return { waits, sleep };
}

/** Resolves once the tick has run `count` times. */
function afterTicks(count: number) {
    let ticks = 0;
    let reached: () => void = () => undefined;
    const done = new Promise<void>(resolve => { reached = resolve; });
    return {
        get ticks() { return ticks; },
        done,
        record: () => { if (++ticks === count) reached(); },
    };
}

describe('BackgroundLoop', () => {
    it('waits the start-up delay first, then the delay chosen after each tick', async () => {
        const { waits, sleep } = fakeSleep();
        const counter = afterTicks(3);
        const loop = new BackgroundLoop(async () => counter.record(), () => 100 * counter.ticks, 5000, sleep);

        loop.start();
        await counter.done;
        await loop.stop();

        expect(waits.slice(0, 3)).toEqual([5000, 100, 200]);
    });

    it('never runs two ticks at once', async () => {
        const { sleep } = fakeSleep();
        const counter = afterTicks(5);
        let running = 0;
        let overlapped = false;
        const loop = new BackgroundLoop(async () => {
            running++;
            overlapped ||= running > 1;
            await new Promise(resolve => setImmediate(resolve));
            running--;
            counter.record();
        }, () => 0, 0, sleep);

        loop.start();
        loop.start();
        await counter.done;
        await loop.stop();

        expect(overlapped).toBe(false);
    });

    it('does not tick after it is stopped, and stopping twice is harmless', async () => {
        const { sleep } = fakeSleep();
        const counter = afterTicks(2);
        const loop = new BackgroundLoop(async () => counter.record(), () => 0, 0, sleep);

        loop.start();
        await counter.done;
        await loop.stop();
        const after = counter.ticks;
        await loop.stop();
        await new Promise(resolve => setImmediate(resolve));

        expect(counter.ticks).toBe(after);
    });

    it('can be started again after it was stopped', async () => {
        const { sleep } = fakeSleep();
        const counter = afterTicks(2);
        const loop = new BackgroundLoop(async () => counter.record(), () => 0, 0, sleep);

        loop.start();
        while (counter.ticks < 1) await new Promise(resolve => setImmediate(resolve));
        await loop.stop();
        loop.start();
        await counter.done;
        await loop.stop();

        expect(counter.ticks).toBeGreaterThanOrEqual(2);
    });

    it('wake cuts a long wait short', async () => {
        let resolveFirst: () => void = () => undefined;
        let resolveSecond: () => void = () => undefined;
        const first = new Promise<void>(resolve => { resolveFirst = resolve; });
        const second = new Promise<void>(resolve => { resolveSecond = resolve; });
        let ticks = 0;
        const loop = new BackgroundLoop(async () => {
            ticks++;
            if (ticks === 1) resolveFirst();
            if (ticks === 2) resolveSecond();
        }, () => 60 * 60_000, 0);

        loop.start();
        await first;
        await new Promise(resolve => setImmediate(resolve)); // the loop is now in its hour-long wait
        loop.wake();
        await second;
        await loop.stop();

        expect(ticks).toBe(2);
    });
});
