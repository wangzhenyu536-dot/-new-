import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 25000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'outputs/R6/e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev:test --workspace @evertrace/web', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
    env: { VITE_FIREBASE_PROJECT_ID: 'demo-evertrace-test', VITE_USE_EMULATORS: 'true', VITE_AUTH_EMULATOR_PORT: '10099', VITE_FIRESTORE_EMULATOR_PORT: '18080', VITE_STORAGE_EMULATOR_PORT: '19199', VITE_FUNCTIONS_EMULATOR_PORT: '15001' } },
});
