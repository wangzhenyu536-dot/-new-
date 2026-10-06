import { test } from '@playwright/test';
import { checkAccountRouteLoading } from '../browser/account-loading';

test.use({ reducedMotion: 'reduce' });
test('registration keeps a readable page while the Spark workspace module loads, then opens it without refresh', async ({ page }) => {
  await checkAccountRouteLoading(page, 'SparkWorkspacePage', 'Community workspace');
});
