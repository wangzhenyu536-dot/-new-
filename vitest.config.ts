import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/rules/**/*.test.ts'], fileParallelism: false, testTimeout: 15000, hookTimeout: 30000, reporters: ['default', 'json'], outputFile: { json: 'outputs/R0/rules-results.json' } } });
