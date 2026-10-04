import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/rules/**/*.test.ts', 'tests/integration/**/*.test.ts'], fileParallelism: false, testTimeout: 20000, hookTimeout: 30000, reporters: ['default', 'json'], outputFile: { json: 'outputs/R1/integration-results.json' } } });
