import { expect, test, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { workbook } from '../fixtures/workbooks.mjs';
import { makeSparkBrowserFixtures, loginSpark, downloadSparkOriginal, s3EegFile, s3TextFile, s3ImageFile, s3Excel, s3Text, s3Image, watchSparkServices } from '../browser/spark-s3';
const fixture = makeSparkBrowserFixtures('s3-edit');
test.use({ reducedMotion: 'reduce' }); test.setTimeout(35000);
test.afterAll(fixture.cleanup);
async function opened(page: Page) {
  const user = await fixture.seedAccount(), category = await fixture.seedCategory(user.uid), title = 'S3 editable ' + randomUUID(), pack = await fixture.seedPack(user, title, category.id);
  await loginSpark(page, user.email, pack.url); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return { user, category, pack };
}
async function edit(page: Page) { const link = page.getByRole('link', { name: 'Edit skill pack', exact: true }); await expect(link).toBeVisible(); await link.click(); await expect(page.getByRole('heading', { name: 'Edit skill pack', exact: true })).toBeVisible(); await expect(page.getByLabel('Title', { exact: true })).toBeEnabled(); }
async function saved(page: Page, title: string) { await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/packs\/[A-Za-z0-9_-]+$/); }
const editCommit = (request: Request, id: string) => request.method() === 'POST' && /\/documents:commit(?:\?.*)?$/.test(request.url()) && (request.postData() || '').includes('/documents/packs/' + id);

test('S3 owner edits title, notes and category while retaining, adding, removing and replacing real originals', async ({ page }) => {
  const forbidden = watchSparkServices(page), { user, pack } = await opened(page), target = await fixture.seedCategory(user.uid, randomUUID());
  const before = (await fixture.database.doc('packs/' + pack.id).get()).data()!;
  await edit(page); await page.getByLabel('Title', { exact: true }).fill(pack.title + ' edited'); await page.getByLabel('Notes', { exact: true }).fill('S3 edited notes'); await page.getByLabel('Category', { exact: true }).selectOption(target.id);
  await page.getByRole('button', { name: 'Remove attachment original.png', exact: true }).click();
  const replacement = Buffer.from(await workbook([['timestamp_ms', 'value'], [0, -7], [12, 8]]));
  await page.getByLabel('Replace attachment original.xlsx', { exact: true }).setInputFiles(s3EegFile('replacement.xlsx', replacement));
  await page.getByLabel('Text file', { exact: true }).setInputFiles(s3TextFile('added.txt', Buffer.from('S3 newly added TXT')));
  await expect(page.getByText('Text file passed · added.txt', { exact: true })).toBeVisible(); await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
  await saved(page, pack.title + ' edited'); await expect(page.getByText('S3 edited notes', { exact: true })).toBeVisible(); await expect(page.getByText(target.name, { exact: true })).toBeVisible();
  await expect(page.locator('.stored-material')).toHaveCount(3); await expect(page.getByRole('heading', { name: 'original.png', exact: true })).toHaveCount(0); await expect(page.getByRole('heading', { name: 'original.xlsx', exact: true })).toHaveCount(0);
  expect(await downloadSparkOriginal(page, 'original.txt')).toEqual(s3Text); expect(await downloadSparkOriginal(page, 'added.txt')).toEqual(Buffer.from('S3 newly added TXT')); expect(await downloadSparkOriginal(page, 'replacement.xlsx')).toEqual(replacement);
  const after = (await fixture.database.doc('packs/' + pack.id).get()).data()!; expect(after.version).toBe(2); expect(after.ownerId).toBe(before.ownerId); expect(after.ownerName).toBe(before.ownerName); expect(after.createdAt.isEqual(before.createdAt)).toBe(true);
  await page.reload(); await expect(page.getByRole('heading', { name: 'replacement.xlsx', exact: true })).toBeVisible(); expect(forbidden).toEqual([]);
});
test('S3 failed edit retains current inputs and every byte of the saved old version, then retries once', async ({ page }) => {
  const { pack } = await opened(page), before = (await fixture.database.doc('packs/' + pack.id).get()).data(); await edit(page);
  await page.getByLabel('Notes', { exact: true }).fill('S3 retry keeps unsaved text'); await page.getByLabel('Text file', { exact: true }).setInputFiles(s3TextFile('retry.txt', Buffer.from('S3 retry file'))); await expect(page.getByText('Text file passed · retry.txt', { exact: true })).toBeVisible();
  await page.route('**/documents:commit?**', route => editCommit(route.request(), pack.id) ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S3 edit failure' } }) }) : route.continue());
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('S3 retry keeps unsaved text'); await expect(page.getByRole('heading', { name: 'retry.txt', exact: true })).toBeVisible(); expect((await fixture.database.doc('packs/' + pack.id).get()).data()).toEqual(before);
  const oldFiles = await fixture.database.collection('packs/' + pack.id + '/files').get(); for (const file of oldFiles.docs) expect(file.get('bytes')).toEqual(pack.files[Number(file.id)].buffer);
  await page.unroute('**/documents:commit?**'); await saved(page, pack.title); await expect(page.getByText('S3 retry file', { exact: true })).toBeVisible(); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(2);
});
test('S3 two real editors reject a stale save without overwriting, keep changes and deliberately reload', async ({ page, browser }) => {
  const { user, pack } = await opened(page), context = await browser.newContext(), other = await context.newPage();
  try { await edit(page); await loginSpark(other, user.email, pack.url + '/edit'); await expect(other.getByRole('heading', { name: 'Edit skill pack', exact: true })).toBeVisible(); await expect(other.getByLabel('Notes', { exact: true })).toBeEnabled();
    await other.getByLabel('Notes', { exact: true }).fill('Second editor unsaved'); await page.getByLabel('Notes', { exact: true }).fill('First editor committed'); await saved(page, pack.title);
    await other.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(other.getByRole('alert')).toContainText('changed since you opened'); await expect(other.getByLabel('Notes', { exact: true })).toHaveValue('Second editor unsaved'); expect((await fixture.database.doc('packs/' + pack.id).get()).get('textContent')).toBe('First editor committed'); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(2);
    await other.getByRole('button', { name: 'Reload latest version', exact: true }).click(); await expect(other.getByLabel('Notes', { exact: true })).toHaveValue('First editor committed'); await other.getByLabel('Notes', { exact: true }).fill('Deliberately reloaded edit'); await saved(other, pack.title); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(3);
  } finally { await context.close(); }
});
test('S3 other member cannot edit even via the direct URL; administrator edits without taking ownership', async ({ page, browser }) => {
  const { pack, user } = await opened(page), member = await fixture.seedAccount('S3 unrelated member'), administrator = await fixture.seedAccount('S3 trusted administrator', 'admin'), context = await browser.newContext(), other = await context.newPage();
  try { await loginSpark(other, member.email, pack.url); await expect(other.getByRole('heading', { name: pack.title, exact: true })).toBeVisible(); await expect(other.getByRole('link', { name: 'Edit skill pack', exact: true })).toHaveCount(0); await other.goto(pack.url + '/edit'); await expect(other.getByRole('heading', { name: 'You cannot edit this skill pack', exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Sign out', exact: true }).click(); await loginSpark(other, administrator.email, pack.url); await edit(other); await other.getByLabel('Notes', { exact: true }).fill('Administrator edit'); await saved(other, pack.title); expect((await fixture.database.doc('packs/' + pack.id).get()).get('ownerId')).toBe(user.uid);
  } finally { await context.close(); }
});
test('S3 removing the only Excel and both text sources is rejected; replacement works on Chinese mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { pack } = await opened(page); await edit(page); await page.getByLabel('Notes', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Remove attachment original.txt', exact: true }).click(); await page.getByRole('button', { name: 'Remove attachment original.xlsx', exact: true }).click(); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Add notes or a valid text file.'); await expect(page.getByRole('alert')).toContainText('Add a valid EEG Excel.'); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(1);
  await page.getByLabel('Text file', { exact: true }).setInputFiles(s3TextFile('mobile.txt')); await page.getByLabel('EEG Excel', { exact: true }).setInputFiles(s3EegFile('mobile.xlsx')); await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible(); await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑技能包', exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'outputs/S3/edit-mobile-zh.png', fullPage: true });
  await page.getByRole('button', { name: '保存修改', exact: true }).click(); await expect(page.getByRole('heading', { name: 'mobile.xlsx', exact: true })).toBeVisible(); await expect(page.getByRole('img', { name: '脑电预览', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'EN', exact: true }).click(); expect(await downloadSparkOriginal(page, 'original.png')).toEqual(s3Image); expect(await downloadSparkOriginal(page, 'mobile.xlsx')).toEqual(s3Excel);
});
test('S3 editing preserves all twelve originals and rejects a thirteenth without changing saved data', async ({ page }) => {
  const { pack } = await opened(page); await edit(page); const added = Array.from({ length: 9 }, (_, i) => s3TextFile('added-' + i + '.txt', Buffer.from('S3 twelfth fixture ' + i)));
  await page.getByLabel('Text file', { exact: true }).setInputFiles(added); await expect(page.getByText('Text file passed · added-8.txt', { exact: true })).toBeVisible(); await saved(page, pack.title); await expect(page.locator('.stored-material')).toHaveCount(12);
  await edit(page); await page.getByLabel('Text file', { exact: true }).setInputFiles(s3TextFile('thirteenth.txt')); await expect(page.getByText('Text file passed · thirteenth.txt', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('12'); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(2);
  await page.getByRole('button', { name: 'Remove attachment thirteenth.txt', exact: true }).click(); await page.getByLabel('Replace attachment original.png', { exact: true }).setInputFiles(s3ImageFile('replaced.png')); await expect(page.getByRole('img', { name: 'replaced.png', exact: true })).toBeVisible(); await saved(page, pack.title); await expect(page.locator('.stored-material')).toHaveCount(12); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(3); expect(await downloadSparkOriginal(page, 'replaced.png')).toEqual(s3Image);
});
test('S3 invalid or oversize replacement keeps the original saved bytes until a valid retry', async ({ page }) => {
  const { pack } = await opened(page); await edit(page); await page.getByLabel('Replace attachment original.xlsx', { exact: true }).setInputFiles(s3EegFile('invalid.xlsx', Buffer.from(await workbook([['timestamp_ms', 'wrong'], [0, 1], [2, 3]]))));
  await expect(page.getByRole('alert').filter({ hasText: 'two column headers' })).toBeVisible(); await page.getByRole('button', { name: 'Save changes', exact: true }).click(); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(1);
  await page.getByLabel('Replace attachment original.png', { exact: true }).setInputFiles(s3ImageFile('oversized.png', Buffer.alloc(512 * 1024 + 1))); await expect(page.getByRole('alert').filter({ hasText: '512 KiB' })).toBeVisible(); await page.getByRole('button', { name: 'Save changes', exact: true }).click(); expect((await fixture.database.doc('packs/' + pack.id + '/files/1').get()).get('bytes')).toEqual(s3Excel);
  await page.getByLabel('Replace attachment original.xlsx', { exact: true }).setInputFiles(s3EegFile('valid-retry.xlsx')); await page.getByLabel('Replace attachment original.png', { exact: true }).setInputFiles(s3ImageFile('valid-retry.png')); await expect(page.getByRole('img', { name: 'valid-retry.png', exact: true })).toBeVisible(); await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible(); await saved(page, pack.title); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(2); expect(await downloadSparkOriginal(page, 'valid-retry.xlsx')).toEqual(s3Excel);
});
test('S3 a committed edit with a lost acknowledgement recovers exactly one new version', async ({ page }) => {
  const { pack } = await opened(page); await edit(page); await page.getByLabel('Notes', { exact: true }).fill('S3 committed once'); let intercepted = false;
  await page.route('**/documents:commit?**', async route => { if (!intercepted && editCommit(route.request(), pack.id)) { intercepted = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect.poll(() => intercepted).toBe(true); await expect.poll(async () => (await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(2); await page.unrouteAll({ behavior: 'wait' });
  const savedNotes = page.getByText('S3 committed once', { exact: true }), retryAlert = page.getByRole('alert').filter({ hasText: 'Could not save' });
  // A committed transaction can still be confirming while the URL remains /edit.
  await expect(savedNotes.or(retryAlert)).toBeVisible();
  if (await retryAlert.isVisible()) {
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('S3 committed once');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  }
  await expect(page).toHaveURL(new RegExp('/packs/' + pack.id + '$'));
  await expect(savedNotes).toBeVisible(); expect((await fixture.database.doc('packs/' + pack.id).get()).get('version')).toBe(2);
});
test('S3 signed-out creator returns to the actual editor after authentication', async ({ page }) => {
  const { user, pack } = await opened(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await loginSpark(page, user.email, pack.url + '/edit'); await expect(page).toHaveURL(new RegExp('/packs/' + pack.id + '/edit$')); await expect(page.getByRole('heading', { name: 'Edit skill pack', exact: true })).toBeVisible(); await expect(page.getByLabel('Title', { exact: true })).toHaveValue(pack.title);
});
