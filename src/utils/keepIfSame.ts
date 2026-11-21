/**
 * For polled status objects: returns `previous` when `next` holds the same values, so a state update with it changes nothing
 * and React does not re-render everything that reads it. Without this, a poll every second made every consumer re-render
 * every second even when nothing had changed. Meant for small plain objects (it compares their JSON).
 */
export function keepIfSame<T>(previous: T, next: T): T {
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
