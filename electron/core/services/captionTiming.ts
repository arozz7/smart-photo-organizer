import type { AISettings } from './ConfigService';

type CaptionSettings = Pick<AISettings, 'vlmEnabled' | 'captionTiming'>;

/**
 * Photo descriptions and tags take about four times as long as finding the faces. By default they follow the face scan
 * in the background; "scan" keeps the old behavior (each photo waits for its description).
 * The same switch (Smart Tags on) still applies to both.
 */
export function captionsRunInScan(settings: CaptionSettings): boolean {
    return Boolean(settings.vlmEnabled) && settings.captionTiming === 'scan';
}

export function captionsRunInBackground(settings: CaptionSettings): boolean {
    return Boolean(settings.vlmEnabled) && settings.captionTiming !== 'scan';
}
