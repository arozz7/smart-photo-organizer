import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../../../../electron/utils/mapWithConcurrency';

/** A promise you resolve by hand, so tests control ordering without timers. */
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
};

describe('mapWithConcurrency', () => {
    it('returns results in input order even when tasks finish out of order', async () => {
        // Arrange
        const gates = [deferred<void>(), deferred<void>(), deferred<void>()];

        // Act
        const run = mapWithConcurrency([0, 1, 2], 3, async i => { await gates[i].promise; return `r${i}`; });
        gates[2].resolve(); gates[0].resolve(); gates[1].resolve();

        // Assert
        expect(await run).toEqual(['r0', 'r1', 'r2']);
    });

    it('never runs more than the limit at once, and refills slots as tasks finish', async () => {
        // Arrange
        const gates = Array.from({ length: 6 }, () => deferred<void>());
        let running = 0;
        let peak = 0;
        const started: number[] = [];

        // Act
        const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async i => {
            started.push(i);
            running++; peak = Math.max(peak, running);
            await gates[i].promise;
            running--;
        });
        await Promise.resolve(); // let the first wave start
        expect(started).toEqual([0, 1]);
        gates[0].resolve();
        await new Promise<void>(res => setImmediate(res));
        expect(started).toEqual([0, 1, 2]); // a freed slot immediately starts the next item
        gates.forEach(g => g.resolve());
        await run;

        // Assert
        expect(peak).toBe(2);
    });

    it('calls onSettled once per item with its index and result', async () => {
        // Arrange
        const seen: [number, string][] = [];

        // Act
        await mapWithConcurrency(['a', 'b'], 1, async s => s.toUpperCase(), (index, result) => { seen.push([index, result]); });

        // Assert
        expect(seen).toEqual([[0, 'A'], [1, 'B']]);
    });

    it.each([0, -3, Number.NaN])('treats an invalid limit (%s) as 1', async limit => {
        // Arrange
        let running = 0;
        let peak = 0;

        // Act
        await mapWithConcurrency([1, 2, 3], limit, async () => { running++; peak = Math.max(peak, running); await Promise.resolve(); running--; });

        // Assert
        expect(peak).toBe(1);
    });

    it('handles an empty list and a limit larger than the list', async () => {
        // Act / Assert
        expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
        expect(await mapWithConcurrency([1, 2], 50, async n => n * 2)).toEqual([2, 4]);
    });

    it('rejects if a task throws (callers decide how to handle per-item errors)', async () => {
        // Act / Assert
        await expect(mapWithConcurrency([1], 1, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    });
});
