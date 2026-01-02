import { PersonService } from '../core/services/PersonService';

const pendingMeanRecalcs = new Map<number, NodeJS.Timeout>();

export const scheduleMeanRecalc = (personId: number) => {
    if (pendingMeanRecalcs.has(personId)) {
        clearTimeout(pendingMeanRecalcs.get(personId)!);
    }

    const timeout = setTimeout(async () => {
        pendingMeanRecalcs.delete(personId);
        try {
            console.log(`[Main] Running scheduled mean recalc for person ${personId}`);
            await PersonService.recalculatePersonMean(personId);
        } catch (e) {
            console.error(`[Main] Scheduled mean recalc failed for ${personId}`, e);
        }
    }, 2000); // 2 second debounce

    pendingMeanRecalcs.set(personId, timeout);
};
