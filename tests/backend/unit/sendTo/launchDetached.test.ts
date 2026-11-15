import { describe, it, expect } from 'vitest';
import { launchDetached } from '../../../../electron/lib/sendTo/launchDetached';

describe('launchDetached', () => {
    it('resolves once the program has started', async () => {
        await expect(launchDetached(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBeUndefined();
    });

    it('rejects when the program cannot be started', async () => {
        await expect(launchDetached('Z:\\no\\such\\ClearFrame.exe', [])).rejects.toThrow();
    });
});
