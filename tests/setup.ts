/**
 * Global test setup file
 * Runs before all tests
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Extend expect with jest-dom matchers (for frontend tests)
import '@testing-library/jest-dom';

// Reset any mocks between tests
beforeEach(() => {
    vi.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
    vi.restoreAllMocks();
});
