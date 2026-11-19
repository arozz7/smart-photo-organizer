/** Waits `ms`, or less when `wake` is called; injected so a loop can be tested without real time. */
export type Sleep = (ms: number, onWake: (wake: () => void) => void) => Promise<void>;

const realSleep: Sleep = (ms, onWake) =>
    new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ms);
        onWake(() => {
            clearTimeout(timer);
            resolve();
        });
    });

/**
 * The "do a step, wait, repeat" loop behind the background services: a first delay after start-up, then one `tick`
 * at a time (never two at once), waiting `delayAfterTick()` between them. `wake()` cuts a wait short; `stop()` ends the
 * loop after the tick in progress. `tick` must not throw (an error would end the loop).
 */
export class BackgroundLoop {
    private stopped = true;
    private done: Promise<void> | null = null;
    private wakeUp: (() => void) | null = null;

    constructor(
        private readonly tick: () => Promise<void>,
        private readonly delayAfterTick: () => number,
        private readonly startupDelayMs: number,
        private readonly sleep: Sleep = realSleep,
    ) {}

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.done = this.run();
    }

    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        this.wake();
        await this.done;
    }

    /** Skips the current wait, so the next tick happens now. */
    wake(): void {
        this.wakeUp?.();
    }

    private async run(): Promise<void> {
        await this.wait(this.startupDelayMs);
        while (!this.stopped) {
            await this.tick();
            if (this.stopped) break;
            await this.wait(this.delayAfterTick());
        }
    }

    private async wait(ms: number): Promise<void> {
        await this.sleep(ms, wake => { this.wakeUp = wake; });
        this.wakeUp = null;
    }
}
