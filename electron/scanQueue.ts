import { scanDirectory, scanFiles } from './scanner';
import { getLibraryPath } from './store';
import logger from './logger';

type ScanTask =
    | { type: 'directory'; path: string; options: any; resolve: (res: any) => void; reject: (err: any) => void; sender: Electron.WebContents }
    | { type: 'files'; paths: string[]; options: any; resolve: (res: any) => void; reject: (err: any) => void; sender: Electron.WebContents };

class ScanQueue {
    private queue: ScanTask[] = [];
    private isProcessing = false;

    enqueueDirectory(path: string, options: any, sender: Electron.WebContents): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ type: 'directory', path, options, resolve, reject, sender });
            this.processNext();
        });
    }

    enqueueFiles(paths: string[], options: any, sender: Electron.WebContents): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ type: 'files', paths, options, resolve, reject, sender });
            this.processNext();
        });
    }

    private async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const task = this.queue.shift();
        if (!task) {
            this.isProcessing = false;
            return;
        }

        logger.info(`[ScanQueue] Starting task: ${task.type} - ${task.type === 'directory' ? task.path : task.paths.length + ' files'}`);

        try {
            const libraryPath = getLibraryPath();
            let result;

            if (task.type === 'directory') {
                result = await scanDirectory(task.path, libraryPath, (count) => {
                    if (!task.sender.isDestroyed()) {
                        task.sender.send('scan-progress', count);
                    }
                }, task.options);
            } else {
                result = await scanFiles(task.paths, libraryPath, (count) => {
                    if (!task.sender.isDestroyed()) {
                        task.sender.send('scan-progress', count);
                    }
                }, task.options);
            }

            task.resolve(result);
        } catch (error) {
            logger.error(`[ScanQueue] Task failed:`, error);
            task.reject(error);
        } finally {
            this.isProcessing = false;
            this.processNext();
        }
    }
}

export const scanQueue = new ScanQueue();
