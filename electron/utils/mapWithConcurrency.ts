/**
 * Runs `worker` over `items` with at most `limit` in flight, returning results in INPUT order.
 *
 * A freed slot immediately picks up the next item. `onSettled` fires as each item finishes (in
 * completion order), which suits progress reporting. If a worker throws, the returned promise
 * rejects; callers that want per-item error isolation should catch inside the worker.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
    onSettled?: (index: number, result: R) => void,
): Promise<R[]> {
    const lanes = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
    const results = new Array<R>(items.length);
    let next = 0;

    const lane = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
            onSettled?.(index, results[index]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, lane));
    return results;
}
