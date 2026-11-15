import { describe, it, expect, vi } from 'vitest';
import {
    CLEARFRAME_WINDOW_TITLE,
    parseTasklistWindowTitles,
    probeClearFrameInstall,
    waitForClearFrameWindow,
} from '../../../../electron/core/services/sendTo/clearFrameInstall';

describe('probeClearFrameInstall', () => {
    it('finds the per-user install under LOCALAPPDATA', () => {
        const exists = vi.fn((p: string) => p === 'C:\\Users\\me\\AppData\\Local\\ClearFrame\\cf-app.exe');

        const found = probeClearFrameInstall({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, exists);

        expect(found).toBe('C:\\Users\\me\\AppData\\Local\\ClearFrame\\cf-app.exe');
    });

    it('returns null when ClearFrame is not installed there', () => {
        expect(probeClearFrameInstall({ LOCALAPPDATA: 'C:\\x' }, () => false)).toBeNull();
    });

    it('returns null without checking anything when LOCALAPPDATA is unknown', () => {
        const exists = vi.fn(() => true);

        expect(probeClearFrameInstall({}, exists)).toBeNull();
        expect(exists).not.toHaveBeenCalled();
    });
});

describe('parseTasklistWindowTitles', () => {
    const csv = [
        '"Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"',
        '"cf-app.exe","1234","Console","1","50,000 K","Running","PC\\me","0:00:01","ClearFrame"',
        '"cf-app.exe","5678","Console","1","9,000 K","Running","PC\\me","0:00:00","N/A"',
    ].join('\r\n');

    it('returns the window title of every listed process, skipping the header', () => {
        expect(parseTasklistWindowTitles(csv)).toEqual(['ClearFrame', 'N/A']);
    });

    it('returns nothing for the "no tasks" message or empty output', () => {
        expect(parseTasklistWindowTitles('INFO: No tasks are running which match the specified criteria.')).toEqual([]);
        expect(parseTasklistWindowTitles('')).toEqual([]);
    });
});

describe('waitForClearFrameWindow', () => {
    const clock = () => {
        let now = 0;
        return { now: () => now, sleep: async (ms: number) => { now += ms; } };
    };

    it('is ready as soon as a window titled ClearFrame exists', async () => {
        const { now, sleep } = clock();

        const ready = await waitForClearFrameWindow({ listWindowTitles: async () => ['N/A', CLEARFRAME_WINDOW_TITLE], now, sleep, timeoutMs: 10_000, pollMs: 250 });

        expect(ready).toBe(true);
    });

    it('keeps polling until the window appears', async () => {
        const { now, sleep } = clock();
        const list = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(['N/A'])
            .mockResolvedValue(['ClearFrame - library']);

        const ready = await waitForClearFrameWindow({ listWindowTitles: list, now, sleep, timeoutMs: 10_000, pollMs: 250 });

        expect(ready).toBe(true);
        expect(list).toHaveBeenCalledTimes(3);
    });

    it('gives up after the timeout', async () => {
        const { now, sleep } = clock();

        const ready = await waitForClearFrameWindow({ listWindowTitles: async () => [], now, sleep, timeoutMs: 1000, pollMs: 250 });

        expect(ready).toBe(false);
    });

    it('treats a failing process listing as not ready instead of throwing', async () => {
        const { now, sleep } = clock();

        const ready = await waitForClearFrameWindow({
            listWindowTitles: async () => { throw new Error('tasklist missing'); },
            now, sleep, timeoutMs: 500, pollMs: 250,
        });

        expect(ready).toBe(false);
    });
});
