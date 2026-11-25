import { describe, it, expect } from 'vitest';
import { EventLoopLagMonitor, type LagSummary } from '../../../electron/utils/EventLoopLagMonitor';

/** A clock and a timer we drive by hand: `run(ms)` is a tick that arrived `ms` after the previous one was due. */
function setup(options: { activity?: () => string; thresholdMs?: number; windowMs?: number } = {}) {
    let time = 0;
    let tick: (() => void) | null = null;
    const reports: LagSummary[] = [];
    const monitor = new EventLoopLagMonitor({
        report: summary => reports.push(summary),
        activity: options.activity ?? (() => 'idle'),
        tickMs: 100,
        thresholdMs: options.thresholdMs ?? 200,
        windowMs: options.windowMs ?? 1000,
        io: {
            now: () => time,
            setInterval: callback => ((tick = callback), 1),
            clearInterval: () => {
                tick = null;
            },
        },
    });
    return {
        monitor,
        reports,
        /** The next tick arrives `lateByMs` after it was due. */
        run: (lateByMs = 0) => {
            time += 100 + lateByMs;
            tick?.();
        },
        isRunning: () => tick !== null,
    };
}

describe('EventLoopLagMonitor', () => {
    it('stays quiet while ticks arrive on time', () => {
        const { monitor, reports, run } = setup();
        monitor.start();

        for (let i = 0; i < 30; i++) run();

        expect(reports).toEqual([]);
    });

    it('stays quiet for a delay below the threshold', () => {
        const { monitor, reports, run } = setup();
        monitor.start();

        for (let i = 0; i < 12; i++) run(i === 3 ? 150 : 0);

        expect(reports).toEqual([]);
    });

    it('reports blocked time once per window, with how often, the worst and the total', () => {
        const { monitor, reports, run } = setup();
        monitor.start();

        run(0);
        run(450); // blocked 450 ms
        run(0);
        run(250); // blocked 250 ms
        for (let i = 0; i < 10; i++) run(0); // the window closes

        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({ count: 2, maxMs: 450, totalMs: 700 });
    });

    it('starts a fresh window after a report', () => {
        const { monitor, reports, run } = setup();
        monitor.start();
        run(500);
        for (let i = 0; i < 12; i++) run(0);

        for (let i = 0; i < 12; i++) run(0);

        expect(reports).toHaveLength(1);
    });

    it('names what the app was doing when it was blocked', () => {
        let doing = 'scan';
        const { monitor, reports, run } = setup({ activity: () => doing });
        monitor.start();

        run(300);
        doing = 'scan, 3 image jobs';
        run(300);
        for (let i = 0; i < 12; i++) run(0);

        expect(reports[0].activity).toBe('scan | scan, 3 image jobs');
    });

    it('stops its timer', () => {
        const { monitor, isRunning } = setup();
        monitor.start();

        monitor.stop();

        expect(isRunning()).toBe(false);
    });
});
