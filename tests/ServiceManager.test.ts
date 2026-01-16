
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger to avoid electron dependency
vi.mock('../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

import { ServiceManager } from '../electron/core/services/ServiceManager';
import { IService } from '../electron/core/interfaces/IService';

// Mock IService
class MockService implements IService {
    public isStarted = false;
    public isStopped = false;
    public name: string;

    constructor(name: string) {
        this.name = name;
    }

    start() {
        this.isStarted = true;
    }

    stop() {
        this.isStopped = true;
    }
}

describe('ServiceManager', () => {
    // Reset singleton for testing (hacky but needed since it's a singleton)
    // In a real app we might want dependency injection, but for now we test the logic.

    it('should register and retrieve services', () => {
        const manager = ServiceManager.getInstance();
        const service = new MockService('TestService');

        manager.register('TestService', service);
        const retrieved = manager.get('TestService');

        expect(retrieved).toBe(service);
    });

    it('should stop all services', async () => {
        const manager = ServiceManager.getInstance();
        const s1 = new MockService('S1');
        const s2 = new MockService('S2');

        manager.register('S1', s1);
        manager.register('S2', s2);

        await manager.stopAll();

        expect(s1.isStopped).toBe(true);
        expect(s2.isStopped).toBe(true);
    });

    it('should handle service stop errors gracefully', async () => {
        const manager = ServiceManager.getInstance();
        const s1 = new MockService('S1');
        const s2 = new MockService('S2');

        // Mock s1 to fail
        vi.spyOn(s1, 'stop').mockRejectedValue(new Error('Stop failed'));

        manager.register('S1', s1);
        manager.register('S2', s2);

        await expect(manager.stopAll()).resolves.not.toThrow();
        expect(s2.isStopped).toBe(true);
    });
});
