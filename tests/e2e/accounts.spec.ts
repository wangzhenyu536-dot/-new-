import { expect, test, type Page } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });
const address = () => `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const password = 'Evertrace-test-2026!';
async function register(page: Page, email: string, name = 'Test researcher') {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}
test('public homepage remains available; protected create route returns there after registration', async ({ page }) => {
  await page.goto('/packs/new'); await expect(page).toHaveURL(/\/login\?returnTo=%2Fpacks%2Fnew/);
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  const email = address(); await register(page, email);
  await expect(page).toHaveURL(/\/packs\/new$/); await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText('Member', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Create a skill pack' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/); await page.reload(); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page).toHaveURL(/\/packs\/new$/);
});
test('member receives access denied for admin route after refresh', async ({ page }) => {
  await page.goto('/register'); await register(page, address()); await expect(page).toHaveURL(/\/packs$/);
  await page.goto('/admin/members'); await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});
test('unsafe return URL never navigates outside the app', async ({ page }) => {
  await page.goto('/register?returnTo=https%3A%2F%2Fevil.example'); await register(page, address()); await expect(page).toHaveURL(/127\.0\.0\.1:5174\/packs$/);
});
test('registration validates password confirmation; duplicate registration and wrong sign-in show errors', async ({ page }) => {
  const email = address(); await page.goto('/register');
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill('mismatch'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Passwords do not match');
  await register(page, email); await expect(page).toHaveURL(/\/packs$/); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/register'); await register(page, email); await expect(page.getByRole('alert')).toContainText('already registered');
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill('Incorrect-2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('email and password');
});
test('profile service failure blocks workspace and retry restores access', async ({ page }) => {
  await page.route('**/ensureProfile', route => route.abort()); await page.goto('/register'); await register(page, address());
  await expect(page.getByRole('alert')).toContainText('account profile'); await expect(page.getByRole('heading', { name: 'Browse skill packs' })).toHaveCount(0);
  await page.unroute('**/ensureProfile'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browse skill packs' })).toBeVisible();
});
test('password reset request reaches Firebase and gives a non-enumerating confirmation', async ({ page }) => {
  const email = address(); await page.goto('/register'); await register(page, email); await expect(page).toHaveURL(/\/packs$/);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
  const response = await page.request.get('http://127.0.0.1:10099/emulator/v1/projects/demo-evertrace-test/oobCodes');
  expect((await response.json()).oobCodes.some((c: { email: string; requestType: string }) => c.email === email && c.requestType === 'PASSWORD_RESET')).toBe(true);
});
test('Chinese account forms fit mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/register'); await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '创建账户', exact: true })).toBeVisible(); await expect(page.getByLabel('确认密码', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const footer = page.locator('.account-footer');
  for (const item of [footer.locator('a'), footer.locator('span')]) { const bounds = await item.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390); }
  await page.screenshot({ path: 'outputs/R1/register-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.screenshot({ path: 'outputs/R1/register-mobile-en.png', fullPage: true });
});

test('trusted first admin initialization updates the live role and allows the admin route', async ({ page }) => {
  const email = address(); await page.goto('/register'); await register(page, email); await expect(page).toHaveURL(/\/packs$/);
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getFirestore } = await import('firebase-admin/firestore');
  const path = '../../scripts/bootstrap-admin.mjs'; const { bootstrapAdmin } = await import(path);
  const app = initializeApp({ projectId: 'demo-evertrace-test' }, `browser-admin-${Date.now()}`);
  try {
    const account = await getAuth(app).getUserByEmail(email);
    await bootstrapAdmin(getFirestore(app), account.uid);
    await expect(page.getByText('Administrator', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Team members', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Team members', exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { name: 'Team members', exact: true })).toBeVisible();
  } finally { await deleteApp(app); }
});

test('homepage account label follows the signed-in name, refresh, language and logout', async ({ page }) => {
  await page.goto('/register'); await register(page, address(), 'Archive researcher'); await expect(page).toHaveURL(/\/packs$/);
  await page.getByRole('link', { name: 'Back to homepage' }).click();
  const account = page.locator('.nav-actions').getByRole('link', { name: 'Archive researcher', exact: true });
  await expect(account).toBeVisible(); await expect(account).toHaveAttribute('href', '/packs');
  await expect(page.getByRole('link', { name: 'SIGN IN', exact: true })).toHaveCount(0);
  await page.reload(); await expect(account).toBeVisible();
  await page.getByRole('button', { name: '中文', exact: true }).click(); await expect(account).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click(); await account.click();
  await expect(page).toHaveURL(/\/packs$/); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to homepage' }).click();
  await expect(page.getByRole('link', { name: 'SIGN IN', exact: true })).toBeVisible();
});
test('homepage account label falls back to email and appears in the mobile menu', async ({ page }) => {
  const email = address(); await page.goto('/register'); await register(page, email, ''); await expect(page).toHaveURL(/\/packs$/);
  await page.getByRole('link', { name: 'Back to homepage' }).click();
  const desktop = page.locator('.nav-actions').getByRole('link', { name: email, exact: true });
  await expect(desktop).toBeVisible();
  const bounds = await desktop.boundingBox(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Open menu' }).click();
  const mobile = page.locator('.nav nav').getByRole('link', { name: email, exact: true });
  await expect(mobile).toBeVisible(); await expect(mobile).toHaveAttribute('href', '/packs');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mobile.click(); await expect(page).toHaveURL(/\/packs$/);
});
