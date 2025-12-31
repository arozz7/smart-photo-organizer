import { recalculatePersonMean } from '../db';

const pendingMeanRecalcs = new Map<number, NodeJS.Timeout>();

export const scheduleMeanRecalc = (db: any, personId: number) => {
    if (pendingMeanRecalcs.has(personId)) {
        clearTimeout(pendingMeanRecalcs.get(personId)!);
    }

    const timeout = setTimeout(() => {
        pendingMeanRecalcs.delete(personId);
        try {
            console.log(`[Main] Running scheduled mean recalc for person ${personId}`);
            recalculatePersonMean(db, personId);
        } catch (e) {
            console.error(`[Main] Scheduled mean recalc failed for ${personId}`, e);
        }
    }, 2000); // 2 second debounce

    pendingMeanRecalcs.set(personId, timeout);
};
