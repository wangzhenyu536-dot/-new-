import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), test: { include: ['tests/spark-s1/**/*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 60000, reporters: ['default','json'], outputFile: { json: 'outputs/S1/integration-results.json' } } });
