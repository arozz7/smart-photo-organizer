import { describe, it, expect } from 'vitest';
import { createProgressReporter, type ScanProgress } from '../../../electron/scanning/scanProgress';

function setup(total: number, intervalMs = 250) {
    const sent: ScanProgress[] = [];
    let time = 1000;
    const reporter = createProgressReporter(total, p => sent.push(p), () => time, intervalMs);
    return { sent, reporter, tick: (ms: number) => (time += ms) };
}

describe('createProgressReporter', () => {
    it('sends the first update at once, with the total and the folder of the file', () => {
        const { sent, reporter } = setup(5354);

        reporter.advance('R:\\Pictures\\2013\\April\\a.jpg');

        expect(sent).toEqual([{ phase: 'processing', done: 1, total: 5354, folder: 'R:\\Pictures\\2013\\April' }]);
    });

    it('holds back updates that come faster than the interval, but keeps counting', () => {
        const { sent, reporter, tick } = setup(100);
        reporter.advance('D:\\a\\1.jpg');

        tick(10);
        reporter.advance('D:\\a\\2.jpg');
        tick(10);
        reporter.advance('D:\\a\\3.jpg');
        tick(300);
        reporter.advance('D:\\a\\4.jpg');

        expect(sent.map(p => p.done)).toEqual([1, 4]);
    });

    it('finish sends the final state even inside the interval', () => {
        const { sent, reporter } = setup(2);
        reporter.advance('D:\\a\\1.jpg');
        reporter.advance('D:\\a\\2.jpg');

        reporter.finish();

        expect(sent[sent.length - 1]).toMatchObject({ done: 2, total: 2 });
    });

    it('reports an empty scan as done with nothing to do', () => {
        const { sent, reporter } = setup(0);

        reporter.finish();

        expect(sent).toEqual([{ phase: 'processing', done: 0, total: 0, folder: '' }]);
    });
});
