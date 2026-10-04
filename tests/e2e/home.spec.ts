import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`homepage and new navigation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const legacyCalls: string[] = []; page.on('request', req => { if (req.url().includes('/api/')) legacyCalls.push(req.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Human wisdom does not arrive as data.' })).toBeVisible();
    const portrait = page.locator('#portraitStage img'); await expect(portrait).toBeVisible();
    expect(await portrait.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.still-life img').scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator('.still-life img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    // Compare unchanged portrait and title geometry against the pre-migration page.
    const baseline = JSON.parse(readFileSync('outputs/R0/baseline/geometry.json', 'utf8')) as Record<string, Record<string, { x: number; width: number; height: number; font: string }>>;
    for (const selector of ['.portrait-stage', '.hero-title-wrap h1']) {
      const actual = await page.locator(selector).evaluate(el => { const rect = el.getBoundingClientRect(); return { x: rect.x, width: rect.width, height: rect.height, font: getComputedStyle(el).fontFamily }; });
      const before = baseline[String(viewport.width)][selector];
      expect(Math.abs(actual.x - before.x)).toBeLessThan(2);
      expect(Math.abs(actual.width - before.width)).toBeLessThan(2);
      expect(Math.abs(actual.height - before.height)).toBeLessThan(2);
      expect(actual.font).toBe(before.font);
    }
    await page.screenshot({ path: `outputs/R0/current/home-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: 'CREATE YOUR FIRST PACK' }).first().click();
    await expect(page).toHaveURL(/\/packs\/new$/);
    await expect(page.getByRole('heading', { name: 'Create a skill pack' })).toBeVisible();
    await expect(page.getByText('Account access arrives in the next iteration.')).toBeVisible();
    expect(errors).toEqual([]); expect(legacyCalls).toEqual([]);
  });
}
test('desktop sign-in, browse links and direct routes are explicit', async ({ page }) => {
  await page.goto('/'); await page.getByRole('link', { name: 'SIGN IN', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/'); await page.getByRole('link', { name: 'BROWSE PACKS', exact: true }).first().click();
  await expect(page).toHaveURL(/\/packs$/); await expect(page.getByRole('heading', { name: 'Browse skill packs' })).toBeVisible();
  await page.goto('/missing'); await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
test('mobile menu opens and closes after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'BROWSE PACKS', exact: true }).first().click();
  await expect(page).toHaveURL(/\/packs$/);
});
test('Chinese / English switch persists across routes and reloads', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('link', { name: '创建第一个技能包' }).first().click();
  await expect(page.getByRole('heading', { name: '创建技能包' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: '创建技能包' })).toBeVisible();
  await page.getByRole('link', { name: '返回首页' }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
test('intro is skippable and portrait motion responds to pointer', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: 'SKIP INTRO' })).toBeVisible();
  await page.getByRole('button', { name: 'SKIP INTRO' }).click();
  await expect(page.locator('#site')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('#portraitStage').hover({ position: { x: 10, y: 10 } });
  await expect.poll(() => page.locator('#portraitStage').evaluate(el => (el as HTMLElement).style.getPropertyValue('--mx'))).not.toBe('');
  await page.reload(); await expect(page.locator('#loader')).toHaveCount(0);
});
