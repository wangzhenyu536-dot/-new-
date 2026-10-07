import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/spark-s5/**/*.test.ts'],fileParallelism:false,testTimeout:30000,hookTimeout:60000,reporters:['default','json'],outputFile:{json:'outputs/S5/release-results.json'}}});
