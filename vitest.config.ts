import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    test: {
        // Global test configuration
        globals: true,

        // Include patterns for test files
        include: ['tests/**/*.test.{ts,tsx}'],

        // Exclude patterns
        exclude: ['node_modules', 'dist', 'dist-electron', 'build'],

        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: [
                'electron/**/*.ts',
                'src/**/*.{ts,tsx}'
            ],
            exclude: [
                'node_modules',
                'tests',
                '**/*.d.ts',
                '**/*.test.{ts,tsx}',
                'src/python/**'
            ]
        },

        // Alias for imports (deprecated in newer Vitest, prefer resolve.alias)
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@electron': path.resolve(__dirname, './electron')
        },

        // Setup files (run before tests)
        setupFiles: ['./tests/setup.ts'],

        // Default to node environment for backend tests
        // Frontend tests will specify jsdom in their test files
        environment: 'node',

        // Pool configuration for stability
        pool: 'forks',

        // Dependency optimization for ESM modules
        deps: {
            optimizer: {
                web: {
                    enabled: true,
                    include: ['jsdom', '@exodus/bytes']
                }
            }
        }
    },

    // Resolve path aliases
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@electron': path.resolve(__dirname, './electron')
        }
    }
});
