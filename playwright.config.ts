import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 20000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'outputs/R0/e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
