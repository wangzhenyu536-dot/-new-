import { expect, test, type Page } from '@playwright/test';
import { workbook, validRows } from '../fixtures/workbooks.mjs';
test.use({ reducedMotion: 'reduce' });
async function enter(page: Page) { await page.goto('/register?returnTo=%2Fpacks%2Fnew'); await page.getByLabel('Email', { exact: true }).fill(`form-${Date.now()}-${Math.random()}@example.test`); await page.getByLabel('Password', { exact: true }).fill('Evertrace-test-2026!'); await page.getByLabel('Confirm password', { exact: true }).fill('Evertrace-test-2026!'); await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Create a skill pack' })).toBeVisible(); }
async function category(page: Page) { const name = `Practice ${Date.now()}`; await page.getByLabel('New category', { exact: true }).fill(name); await page.getByRole('button', { name: 'Add category', exact: true }).click(); await expect(page.getByLabel('Category', { exact: true })).toContainText(name); }
test('required-field errors and valid text plus Excel preview without saving', async ({ page }) => {
  await enter(page); await page.getByRole('button', { name: 'Check materials', exact: true }).click();
  for (const message of ['Enter a title', 'Choose a category', 'Add notes or a valid text file', 'Add a valid EEG Excel']) await expect(page.getByRole('alert')).toContainText(message);
  await page.getByLabel('Title', { exact: true }).fill('Synthetic skill'); await category(page); await page.getByLabel('Notes', { exact: true }).fill('Synthetic practice notes');
  await page.getByLabel('EEG Excel', { exact: true }).setInputFiles({ name: 'synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook()) });
  await expect(page.getByRole('img', { name: 'EEG preview' })).toBeVisible(); await expect(page.getByText('3 samples', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check materials', exact: true }).click(); await expect(page.getByRole('status').filter({hasText:'Materials passed the local check'})).toContainText('Materials passed the local check');
  await expect(page.getByRole('button', { name: 'Save skill pack', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove Excel', exact: true }).click(); await page.getByRole('button', { name: 'Check materials', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Add a valid EEG Excel');
});
test('Excel errors identify sheet/row/column and replacement restores preview', async ({ page }) => {
  await enter(page); const input = page.getByLabel('EEG Excel', { exact: true });
  await input.setInputFiles({ name: 'invalid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook([validRows[0], [0, 1], [2, null], [4, 3]])) });
  await expect(page.getByRole('alert')).toContainText('Row 3'); await expect(page.getByRole('alert')).toContainText('value'); await expect(page.getByRole('img', { name: 'EEG preview' })).toHaveCount(0);
  await input.setInputFiles({ name: 'valid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook()) }); await expect(page.getByRole('img', { name: 'EEG preview' })).toBeVisible();
});
test('UTF-8 text file can satisfy text requirement and empty replacement invalidates it', async ({ page }) => {
  await enter(page); await page.getByLabel('Title', { exact: true }).fill('Text attachment'); await category(page);
  await page.getByLabel('Text file', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic UTF-8 notes') });
  await page.getByLabel('EEG Excel', { exact: true }).setInputFiles({ name: 'valid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook()) });
  await expect(page.getByRole('img', { name: 'EEG preview' })).toBeVisible(); await page.getByRole('button', { name: 'Check materials', exact: true }).click(); await expect(page.getByRole('status').filter({hasText:'Materials passed the local check'})).toContainText('Materials passed the local check');
  await page.getByLabel('Text file', { exact: true }).setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('  ') }); await expect(page.getByRole('alert')).toContainText('Text file is empty');
});
test('category creation failure keeps input and succeeds after retry', async ({ page }) => {
  await enter(page); const name = `Retry ${Date.now()}`; await page.getByLabel('New category', { exact: true }).fill(name); await page.route('**/createCategory', route => route.abort()); await page.getByRole('button', { name: 'Add category', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Could not create the category'); await expect(page.getByLabel('New category', { exact: true })).toHaveValue(name); await page.unroute('**/createCategory'); await page.getByRole('button', { name: 'Add category', exact: true }).click(); await expect(page.getByLabel('Category', { exact: true })).toContainText(name);
});
test('Chinese form fits mobile and synthetic example can be downloaded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await enter(page); await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByLabel('标题', { exact: true })).toBeVisible(); await expect(page.getByLabel('脑电 Excel', { exact: true })).toBeVisible(); await expect(page.getByText('选择文件', { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '下载合成 Excel 示例', exact: true }).click()]); expect(download.suggestedFilename()).toBe('synthetic-eeg-valid.xlsx');
  await page.screenshot({ path: 'outputs/R2/create-mobile.png', fullPage: true });
});

test('rapid file replacement only shows the latest file result', async ({ page }) => {
  await enter(page); const input = page.getByLabel('EEG Excel', { exact: true });
  await input.setInputFiles({ name: 'older-valid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook()) });
  await input.setInputFiles({ name: 'latest-broken.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByRole('alert')).toContainText('latest-broken.xlsx'); await expect(page.getByRole('img', { name: 'EEG preview' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Excel', exact: true }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
});
