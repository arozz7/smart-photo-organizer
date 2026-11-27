/**
 * Lets background work start only after a stretch without any other work.
 * The "busy" flags of the app drop for a moment between two photos of a scan, so a single look at "nothing is running"
 * is not enough: work that holds the engine for seconds (face checks, captions) would slip in and make the scan wait behind it.
 * Call `isQuiet` with the current busy state each time the background work would like to start.
 */
export class QuietGate {
    private quietSince: number | null = null;

    constructor(
        private readonly quietMs: number,
        private readonly now: () => number = Date.now,
    ) {}

    isQuiet(busy: boolean): boolean {
        if (busy) {
            this.quietSince = null;
            return false;
        }
        const now = this.now();
        this.quietSince ??= now;
        return now - this.quietSince >= this.quietMs;
    }
}
