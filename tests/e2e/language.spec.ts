import { expect, test } from '@playwright/test';

test.describe('language preference', () => {
  test.use({ locale: 'zh-CN', reducedMotion: 'reduce' });
  for (const preference of [null, 'unsupported']) {
    test(`defaults to English with Chinese browser and ${preference ?? 'no'} saved preference`, async ({ page }) => {
      await page.addInitScript(value => {
        if (value === null) localStorage.removeItem('evertraceLanguage');
        else localStorage.setItem('evertraceLanguage', value);
      }, preference);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { name: 'Human wisdom does not arrive as data.' })).toBeVisible();
    });
  }
  test('keeps a manually selected Chinese preference', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('evertraceLanguage', 'zh-CN'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('button', { name: '中文', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});
