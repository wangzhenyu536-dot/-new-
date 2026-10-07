import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { makeSparkBrowserFixtures, loginSpark, watchSparkServices } from '../browser/spark-s3';
const fixtures = makeSparkBrowserFixtures('s3-query');
test.use({ reducedMotion: 'reduce' }); test.setTimeout(35000); test.afterAll(fixtures.cleanup);
async function fixture(page: Page) {
  const member = await fixtures.seedAccount('S3 query member'), other = await fixtures.seedAccount('S3 another owner'), tag = 'S3 ' + randomUUID().slice(0, 8), categories = [await fixtures.seedCategory(member.uid, randomUUID()), await fixtures.seedCategory(member.uid, randomUUID())];
  const time = Date.now() + 60000;
  const packs = await Promise.all(Array.from({ length: 25 }, (_, i) => fixtures.seedPack(i % 2 ? other : member, tag + ' ' + String(i === 12 ? 11 : i).padStart(2, '0'), categories[i % 3 ? 0 : 1].id, { createdAt: Timestamp.fromMillis(time + Math.floor(i / 2)) })));
  await loginSpark(page, member.email); await expect(page.getByRole('heading', { name: 'Community workspace', exact: true })).toBeVisible();
  const prefixOrder = [...packs].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.id.localeCompare(b.id));
  const dateOrder = packs.map((pack, i) => ({ ...pack, tick: Math.floor(i / 2) })).sort((a, b) => b.tick - a.tick || b.id.localeCompare(a.id));
  return { member, other, tag, categories, packs, prefixOrder, dateOrder };
}
async function search(page: Page, prefix: string) { const input = page.getByLabel('Title prefix', { exact: true }); await expect(input).toBeVisible(); await input.fill(prefix); await page.getByRole('button', { name: 'Search', exact: true }).click(); await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(prefix.trim()); }
async function hrefs(page: Page) { return page.locator('.pack-list li > a').evaluateAll(links => links.map(link => link.getAttribute('href'))); }
async function pageEquals(page: Page, ids: string[]) { await expect(page.locator('.pack-list li')).toHaveCount(ids.length); await expect.poll(() => hrefs(page)).toEqual(ids.map(id => '/packs/' + id)); }

test('S3 default list uses twelve newest packs with stable timestamp and document ID ordering', async ({ page }) => {
  const f = await fixture(page); await pageEquals(page, f.dateOrder.slice(0, 12).map(pack => pack.id)); await expect(page.getByText('Newest first', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
});
test('S3 prefix, real category and mine filters combine, normalize fullwidth case and survive URL refresh', async ({ page }) => {
  const forbidden = watchSparkServices(page), f = await fixture(page), fullwidth = f.tag.toUpperCase().replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 0xfee0)); await search(page, fullwidth);
  await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id)); await page.getByLabel('Filter category', { exact: true }).selectOption(f.categories[0].id); await page.getByLabel('Show', { exact: true }).selectOption('mine');
  const expected = f.packs.filter((_, i) => i % 2 === 0 && i % 3 !== 0).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)); await pageEquals(page, expected.map(pack => pack.id));
  for (const row of await page.locator('.pack-list li').allTextContents()) { expect(row).toContain(f.categories[0].name); expect(row).toContain('S3 query member'); expect(row).not.toContain('S3 another owner'); }
  const url = new URL(page.url()); expect(url.searchParams.get('category')).toBe(f.categories[0].id); expect(url.searchParams.get('scope')).toBe('mine'); await page.reload(); await expect(page.getByLabel('Title prefix', { exact: true })).toHaveValue(fullwidth); await expect(page.getByLabel('Show', { exact: true })).toHaveValue('mine'); await pageEquals(page, expected.map(pack => pack.id)); expect(forbidden).toEqual([]);
});
test('S3 three cursor pages remain stable after an earlier insertion, go back and reset when scope changes', async ({ page }) => {
  const f = await fixture(page); await search(page, f.tag); await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id));
  await fixtures.seedPack(f.other, f.tag + ' - newly inserted before cursor', f.categories[0].id);
  await page.getByRole('button', { name: 'Next page', exact: true }).dblclick(); await pageEquals(page, f.prefixOrder.slice(12, 24).map(pack => pack.id)); await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click(); await pageEquals(page, f.prefixOrder.slice(24).map(pack => pack.id)); await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click(); await pageEquals(page, f.prefixOrder.slice(12, 24).map(pack => pack.id));
  await page.getByLabel('Show', { exact: true }).selectOption('mine'); const mine = f.prefixOrder.filter(pack => f.packs.indexOf(pack) % 2 === 0);
  // prefixOrder retains object references, so the trusted fixture ownership is known.
  await pageEquals(page, mine.slice(0, 12).map(pack => pack.id)); await expect(page.getByText('Page 1', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
});
test('S3 changing filters during pagination never mixes old results, and empty matches can be cleared', async ({ page }) => {
  const f = await fixture(page); await search(page, f.tag); await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id)); await page.getByRole('button', { name: 'Next page', exact: true }).click(); await page.getByLabel('Filter category', { exact: true }).selectOption(f.categories[1].id);
  const expected = f.packs.filter((_, i) => i % 3 === 0).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)); await pageEquals(page, expected.map(pack => pack.id)); await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
  await search(page, 'No S3 match ' + randomUUID()); await expect(page.getByText('No skill packs match these filters.', { exact: true })).toBeVisible(); await expect(page.locator('.pack-list li')).toHaveCount(0); await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect(page.getByLabel('Title prefix', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Show', { exact: true })).toHaveValue('all'); await pageEquals(page, f.dateOrder.slice(0, 12).map(pack => pack.id));
});
test('S3 failed next page retains the current twelve rows and Retry loads the intended page once', async ({ page, context }) => {
  test.setTimeout(45000); const f = await fixture(page); await search(page, f.tag); await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id));
  await context.setOffline(true); try { await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Could not load skill packs', { timeout: 20000 }); await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id)); } finally { await context.setOffline(false); }
  await page.getByRole('button', { name: 'Retry', exact: true }).click(); await pageEquals(page, f.prefixOrder.slice(12, 24).map(pack => pack.id)); expect(new Set(await hrefs(page)).size).toBe(12); await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
});
test('S3 filtered URL is preserved through sign-out and sign-in with the exact real category', async ({ page }) => {
  const f = await fixture(page), target = '/packs?q=' + encodeURIComponent(f.tag) + '&category=' + encodeURIComponent(f.categories[0].id) + '&scope=mine'; await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await loginSpark(page, f.member.email, target);
  await expect(page.getByLabel('Title prefix', { exact: true })).toHaveValue(f.tag); await expect(page.getByLabel('Filter category', { exact: true })).toHaveValue(f.categories[0].id); await expect(page.getByLabel('Show', { exact: true })).toHaveValue('mine'); await expect(page.locator('.pack-list li')).toHaveCount(8); expect(new URL(page.url()).searchParams.get('category')).toBe(f.categories[0].id);
});
test('S3 English and Chinese mobile filters and page navigation fit, retain language and keep titles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const f = await fixture(page); await search(page, f.tag); await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'outputs/S3/query-mobile-en.png', fullPage: true });
  await page.getByRole('button', { name: '中文', exact: true }).click(); await expect(page.getByLabel('标题前缀', { exact: true })).toHaveValue(f.tag); await page.getByRole('button', { name: '下一页', exact: true }).click(); await pageEquals(page, f.prefixOrder.slice(12, 24).map(pack => pack.id)); await expect(page.getByText('第 2 页', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'outputs/S3/query-mobile-zh.png', fullPage: true });
  await page.reload(); await expect(page.getByRole('heading', { name: '社区工作区', exact: true })).toBeVisible(); await expect(page.getByLabel('标题前缀', { exact: true })).toHaveValue(f.tag); await pageEquals(page, f.prefixOrder.slice(0, 12).map(pack => pack.id));
});
