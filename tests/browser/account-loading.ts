import { expect, type Page, type Route } from '@playwright/test';

export const accountPassword = 'Evertrace-test-2026!';
export const accountEmail = () => `loading-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

export async function registerAccount(page: Page, email: string, name = 'Loading researcher') {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(accountPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(accountPassword);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}

// Hold a genuinely cold route module rather than the account/profile request.
export async function holdPageModule(page: Page, moduleName: string) {
  const pattern = new RegExp(`/src/pages/${moduleName}\\.tsx(?:\\?|$)`);
  let release!: () => void;
  let markRequested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { markRequested = resolve; });
  const handler = async (route: Route) => {
    markRequested();
    await gate;
    await route.continue();
  };
  await page.route(pattern, handler);
  return {
    requested,
    release,
    dispose: async () => { release(); await page.unrouteAll({ behavior: 'wait' }); },
  };
}

export async function checkAccountRouteLoading(page: Page, moduleName: string, workspaceHeading: string) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const delayed = await holdPageModule(page, moduleName);
  try {
    await page.goto('/register');
    const email = accountEmail();
    await registerAccount(page, email);
    await delayed.requested;
    await expect(page).toHaveURL(/\/packs$/);
    const status = page.getByRole('status').filter({ hasText: /^Website loading$/ });
    await expect(status).toBeVisible();
    const shell = page.locator('.account-page').filter({ has: status });
    await expect(shell).toBeVisible();
    await expect(shell.getByRole('link', { name: 'Back to homepage' })).toBeVisible();
    const background = await shell.evaluate(element => getComputedStyle(element).backgroundColor);
    const foreground = await status.evaluate(element => getComputedStyle(element).color);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    expect(foreground).not.toBe(background);
    delayed.release();
    await expect(page.getByRole('heading', { name: workspaceHeading, exact: true })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^Website loading$/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await delayed.dispose();
  }
}
