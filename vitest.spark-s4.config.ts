import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), test: {include:['tests/spark-s4/**/*.test.ts'],fileParallelism:false,testTimeout:30000,hookTimeout:60000,reporters:['default','json'],outputFile:{json:'outputs/S4/integration-results.json'}} });
