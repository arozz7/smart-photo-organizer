/**
 * Global test setup file
 * Runs before all tests
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Extend expect with jest-dom matchers (for frontend tests)
import '@testing-library/jest-dom';

// Mock problematic ESM dependencies for jsdom
vi.mock('html-encoding-sniffer', () => ({
    default: vi.fn(),
    sniffer: vi.fn()
}));

// Reset any mocks between tests
beforeEach(() => {
    vi.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
    vi.restoreAllMocks();
});
