import logger from '../../logger';
import { IService } from '../interfaces/IService';

export class ServiceManager {
    private static instance: ServiceManager;
    private services: Map<string, IService> = new Map();

    private constructor() { }

    static getInstance(): ServiceManager {
        if (!ServiceManager.instance) {
            ServiceManager.instance = new ServiceManager();
        }
        return ServiceManager.instance;
    }

    register(name: string, service: IService) {
        this.services.set(name, service);
        logger.info(`[ServiceManager] Registered service: ${name}`);
    }

    get(name: string): IService | undefined {
        return this.services.get(name);
    }

    async startAll() {
        logger.info('[ServiceManager] Starting all services...');
        for (const [name, service] of this.services) {
            try {
                logger.info(`[ServiceManager] Starting ${name}...`);
                await service.start();
            } catch (error) {
                logger.error(`[ServiceManager] Failed to start ${name}:`, error);
            }
        }
    }

    async stopAll() {
        logger.info('[ServiceManager] Stopping all services...');
        const promises: Promise<void>[] = [];

        for (const [name, service] of this.services) {
            logger.info(`[ServiceManager] Stopping ${name}...`);
            // We wrap in a promise to ensure we catch errors and don't block others if one fails
            // although Promise.all handles parallel, we might want sequential if deps exist?
            // For now, parallel is faster and assumes loose coupling.
            promises.push(
                Promise.resolve(service.stop()).catch(err => {
                    logger.error(`[ServiceManager] Error stopping ${name}:`, err);
                })
            );
        }

        await Promise.all(promises);
        logger.info('[ServiceManager] All services stopped.');
    }
}
