import { test } from '@playwright/test';
import { checkAccountRouteLoading } from '../browser/account-loading';

test.use({ reducedMotion: 'reduce' });
test('registration keeps a readable page while the legacy workspace module loads, then opens it without refresh', async ({ page }) => {
  await checkAccountRouteLoading(page, 'PacksPage', 'Browse skill packs');
});
