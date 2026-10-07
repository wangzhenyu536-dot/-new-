import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { makeSparkBrowserFixtures, loginSpark, downloadSparkOriginal, s3Excel, s3Image, s3Text, s3EegFile, watchSparkServices } from '../browser/spark-s3';

const fixtures = makeSparkBrowserFixtures('s4-ui');
test.use({ reducedMotion: 'reduce' }); test.setTimeout(35000); test.afterAll(fixtures.cleanup);
const commit = (request: Request) => request.method() === 'POST' && /\/documents:commit(?:\?.*)?$/.test(request.url());
const hasPath = (request: Request, path: string) => commit(request) && (request.postData() || '').includes('/documents/' + path);
async function packFixture(page: Page, admin = false) {
  const owner = await fixtures.seedAccount('S4 deletion owner'), actor = admin ? await fixtures.seedAccount('S4 deletion administrator', 'admin') : owner;
  const category = await fixtures.seedCategory(owner.uid), pack = await fixtures.seedPack(owner, 'S4 deletion ' + randomUUID(), category.id);
  await loginSpark(page, actor.email, pack.url); await expect(page.getByRole('heading', { name: pack.title, exact: true })).toBeVisible();
  return { owner, actor, category, pack };
}
async function openDelete(page: Page) {
  const button = page.getByRole('button', { name: 'Delete skill pack', exact: true }); await expect(button).toBeVisible(); await button.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm skill pack deletion', exact: true }); await expect(dialog).toBeVisible(); return dialog;
}
async function permanent(dialog: Locator) { await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click(); }
async function gone(id: string) {
  await expect.poll(async () => (await fixtures.database.doc('packs/' + id).get()).exists).toBe(false);
  expect((await fixtures.database.collection('packs/' + id + '/files').get()).size).toBe(0); expect((await fixtures.database.collection('packs/' + id + '/groups').get()).size).toBe(0);
}
async function adminFixture(page: Page, count = 1) {
  const administrator = await fixtures.seedAccount('S4 category administrator', 'admin'), member = await fixtures.seedAccount('S4 category owner');
  const source = await fixtures.seedCategory(member.uid), target = await fixtures.seedCategory(member.uid);
  const packs = await Promise.all(Array.from({ length: count }, (_, i) => fixtures.seedPack(member, 'S4 migration ' + randomUUID() + ' ' + i, source.id)));
  await loginSpark(page, administrator.email); await expect(page.getByRole('heading', { name: 'Community workspace', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Manage categories', exact: true }); await expect(link).toBeVisible(); await link.click(); await expect(page.getByRole('heading', { name: 'Manage categories', exact: true })).toBeVisible();
  return { administrator, member, source, target, packs };
}
function categoryRow(page: Page, name: string) { return page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) }); }
async function categoryDialog(page: Page, name: string, action: 'Rename' | 'Delete category') {
  const button = categoryRow(page, name).getByRole('button', { name: action, exact: true }); await expect(button).toBeVisible(); await button.click();
  const dialog = page.getByRole('dialog', { name: action === 'Rename' ? 'Rename category' : 'Delete category', exact: true }); await expect(dialog).toBeVisible(); return dialog;
}

test('S4 deleting your own skill pack requires confirmation and Cancel or Escape keeps every original', async ({ page }) => {
  const forbidden = watchSparkServices(page), { pack } = await packFixture(page), before = (await fixtures.database.doc('packs/' + pack.id).get()).data();
  let dialog = await openDelete(page); await expect(dialog).toContainText('cannot be recovered'); await expect(dialog.getByRole('button', { name: 'Delete permanently', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Delete skill pack', exact: true })).toBeFocused();
  dialog = await openDelete(page); await dialog.getByRole('checkbox').check(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  expect((await fixtures.database.doc('packs/' + pack.id).get()).data()).toEqual(before);
  expect(await downloadSparkOriginal(page, 'original.txt')).toEqual(s3Text); expect(await downloadSparkOriginal(page, 'original.xlsx')).toEqual(s3Excel); expect(await downloadSparkOriginal(page, 'original.png')).toEqual(s3Image); expect(forbidden).toEqual([]);
});
test('S4 an ordinary creator permanently deletes their own twelve originals and both manifests once', async ({ page }) => {
  const { owner, category } = await packFixture(page), pack = await fixtures.seedPack(owner, 'S4 twelve delete ' + randomUUID(), category.id, { files: Array.from({ length: 12 }, (_, i) => ({ kind: i === 0 ? 'eeg' as const : 'text' as const, name: i === 0 ? 'all.xlsx' : 'note-' + i + '.txt', mimeType: i === 0 ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain', buffer: i === 0 ? s3Excel : Buffer.from('S4 original ' + i) })) });
  await page.goto(pack.url); await expect(page.getByRole('heading', { name: pack.title, exact: true })).toBeVisible(); const dialog = await openDelete(page); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Skill pack deleted', exact: true })).toBeVisible(); await gone(pack.id); await page.goto(pack.url); await expect(page.getByRole('heading', { name: 'Skill pack not found', exact: true })).toBeVisible();
  await page.goto('/packs?q=' + encodeURIComponent(pack.title)); await expect(page.getByText('No skill packs match these filters.', { exact: true })).toBeVisible();
});
test('S4 an administrator can delete another member pack while ordinary members have no deletion or admin entry', async ({ page, browser }) => {
  const { pack } = await packFixture(page, true), other = await fixtures.seedAccount('S4 unrelated member'), context = await browser.newContext(), otherPage = await context.newPage();
  try {
    await loginSpark(otherPage, other.email, pack.url); await expect(otherPage.getByRole('heading', { name: pack.title, exact: true })).toBeVisible(); await expect(otherPage.getByRole('button', { name: 'Delete skill pack', exact: true })).toHaveCount(0);
    await otherPage.goto('/packs'); await expect(otherPage.getByRole('link', { name: 'Manage categories', exact: true })).toHaveCount(0); await otherPage.goto('/admin/categories'); await expect(otherPage.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    await permanent(await openDelete(page)); await expect(page.getByRole('heading', { name: 'Skill pack deleted', exact: true })).toBeVisible(); await gone(pack.id);
    await otherPage.goto(pack.url); await expect(otherPage.getByRole('heading', { name: 'Skill pack not found', exact: true })).toBeVisible(); await expect(otherPage.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
test('S4 a failed deletion request preserves confirmation and old bytes before a real retry', async ({ page }) => {
  const { pack } = await packFixture(page), before = (await fixtures.database.doc('packs/' + pack.id).get()).data(), dialog = await openDelete(page);
  await page.route('**/documents:commit?**', route => hasPath(route.request(), 'packs/' + pack.id) ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S4 start failure' } }) }) : route.continue());
  await permanent(dialog); await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog.getByRole('checkbox')).toBeChecked(); expect((await fixtures.database.doc('packs/' + pack.id).get()).data()).toEqual(before);
  const originals = await fixtures.database.collection('packs/' + pack.id + '/files').get(); for (const original of originals.docs) expect(original.get('bytes')).toEqual(pack.files[Number(original.id)].buffer);
  await page.unrouteAll({ behavior: 'wait' }); await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Skill pack deleted', exact: true })).toBeVisible(); await gone(pack.id);
});
test('S4 stale detail deletion stops after a version change and keeps the newer pack', async ({ page }) => {
  const { pack } = await packFixture(page), dialog = await openDelete(page), root = fixtures.database.doc('packs/' + pack.id), batch = fixtures.database.batch();
  batch.update(root, { version: 2, title: pack.title + ' updated', titleSearch: (pack.title + ' updated').toLowerCase() });
  for (const group of (await root.collection('groups').get()).docs) batch.update(group.ref, { version: 2 });
  for (const file of (await root.collection('files').get()).docs) batch.update(file.ref, { version: 2 });
  await batch.commit();
  await permanent(dialog); await expect(dialog.getByRole('alert')).toContainText('changed'); expect((await fixtures.database.doc('packs/' + pack.id).get()).get('status')).toBe('ready'); expect((await fixtures.database.collection('packs/' + pack.id + '/files').get()).size).toBe(3);
});
test('S4 category renaming keeps its ID and originals, prevents duplicate names and reuses the renamed category', async ({ page }) => {
  const f = await adminFixture(page), renamed = f.source.name + ' renamed'; let dialog = await categoryDialog(page, f.source.name, 'Rename');
  await dialog.getByLabel('Category name', { exact: true }).fill(renamed); await dialog.getByRole('button', { name: 'Save name', exact: true }).click(); await expect(categoryRow(page, renamed)).toBeVisible();
  expect((await fixtures.database.doc('categories/' + f.source.id).get()).get('name')).toBe(renamed); expect((await fixtures.database.doc('packs/' + f.packs[0].id).get()).get('categoryId')).toBe(f.source.id);
  dialog = await categoryDialog(page, renamed, 'Rename'); await dialog.getByLabel('Category name', { exact: true }).fill(f.target.name.toUpperCase()); await dialog.getByRole('button', { name: 'Save name', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('already in use'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('New category', { exact: true }).fill(renamed.toUpperCase()); await page.getByRole('button', { name: 'Add category', exact: true }).click(); await expect(page.getByText('This category already exists.', { exact: true })).toBeVisible();
  const categories = await fixtures.database.collection('categories').get(); expect(categories.docs.filter(value => String(value.get('name')).toLowerCase() === renamed.toLowerCase())).toHaveLength(1);
  await page.goto(f.packs[0].url); await expect(page.getByText(renamed, { exact: true })).toBeVisible(); expect(await downloadSparkOriginal(page, 'original.xlsx')).toEqual(s3Excel);
});
test('S4 a used category needs a destination and confirmation, then migrates all packs without changing original bytes', async ({ page }) => {
  const forbidden = watchSparkServices(page), f = await adminFixture(page, 3), before = await Promise.all(f.packs.map(pack => fixtures.database.doc('packs/' + pack.id).get()));
  const dialog = await categoryDialog(page, f.source.name, 'Delete category'); await expect(dialog).toContainText('3 skill packs'); await dialog.getByRole('checkbox').check(); await expect(dialog.getByRole('button', { name: 'Delete category', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); expect((await fixtures.database.doc('categories/' + f.source.id).get()).exists).toBe(true);
  const retry = await categoryDialog(page, f.source.name, 'Delete category'); await retry.getByLabel('Move skill packs to', { exact: true }).selectOption(f.target.id); await retry.getByRole('checkbox').check(); await retry.getByRole('button', { name: 'Delete category', exact: true }).click();
  await expect(categoryRow(page, f.source.name)).toHaveCount(0); expect((await fixtures.database.doc('categories/' + f.source.id).get()).exists).toBe(false);
  for (const [i, pack] of f.packs.entries()) {
    const current = await fixtures.database.doc('packs/' + pack.id).get(); expect(current.get('categoryId')).toBe(f.target.id); expect(current.get('ownerId')).toBe(before[i].get('ownerId')); expect(current.get('createdAt').isEqual(before[i].get('createdAt'))).toBe(true);
    for (const original of (await fixtures.database.collection('packs/' + pack.id + '/files').get()).docs) expect(original.get('bytes')).toEqual(pack.files[Number(original.id)].buffer);
  }
  await page.goto(f.packs[0].url); await expect(page.getByText(f.target.name, { exact: true })).toBeVisible(); expect(await downloadSparkOriginal(page, 'original.png')).toEqual(s3Image); expect(forbidden).toEqual([]);
});
test('S4 English and Chinese mobile category management deletes an empty category without a destination', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const f = await adminFixture(page, 0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'outputs/S4/categories-mobile-en.png', fullPage: true });
  await page.getByRole('button', { name: '中文', exact: true }).click(); await expect(page.getByRole('heading', { name: '分类管理', exact: true })).toBeVisible(); const row = categoryRow(page, f.source.name); await row.getByRole('button', { name: '删除分类', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除分类', exact: true }); await expect(dialog).toContainText('无需目标分类'); await expect(dialog.getByRole('button', { name: '删除分类', exact: true })).toBeDisabled(); await dialog.getByRole('checkbox').check(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'outputs/S4/categories-dialog-mobile-zh.png', fullPage: true });
  await dialog.getByRole('button', { name: '删除分类', exact: true }).click(); await expect(row).toHaveCount(0); expect((await fixtures.database.doc('categories/' + f.source.id).get()).exists).toBe(false); await page.reload(); await expect(page.getByRole('heading', { name: '分类管理', exact: true })).toBeVisible();
});

test('S4 interrupted cleanup revokes access, survives refresh and lets the owner finish only their own operation', async ({ page, browser }) => {
  const { owner, category } = await packFixture(page), pack = await fixtures.seedPack(owner, 'S4 interrupted twelve ' + randomUUID(), category.id, { files: Array.from({ length: 12 }, (_, i) => ({ kind: i === 0 ? 'eeg' as const : 'text' as const, name: i === 0 ? 'all.xlsx' : 'note-' + i + '.txt', mimeType: i === 0 ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain', buffer: i === 0 ? s3Excel : Buffer.from('S4 cleanup original ' + i) })) });
  await page.goto(pack.url); await expect(page.getByRole('heading', { name: pack.title, exact: true })).toBeVisible();
  let secondGroupRejected = false;
  await page.route('**/documents:commit?**', async route => { if (hasPath(route.request(), 'packs/' + pack.id + '/groups/1')) { secondGroupRejected = true; await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S4 second group cleanup failure' } }) }); } else await route.continue(); });
  await permanent(await openDelete(page)); const job = page.locator('.pending-operation').filter({ hasText: pack.id }); await expect(job.getByRole('button', { name: 'Continue cleanup', exact: true })).toBeVisible();
  // Pending is visible as soon as access is revoked, before group cleanup ends.
  await expect.poll(() => secondGroupRejected).toBe(true); await expect(job.getByRole('button', { name: 'Continue cleanup', exact: true })).toBeEnabled();
  expect((await fixtures.database.doc('packs/' + pack.id).get()).get('status')).toBe('deleting'); expect((await fixtures.database.doc('sparkOperations/pack-' + pack.id).get()).get('status')).toBe('pending');
  expect((await fixtures.database.doc('packs/' + pack.id + '/groups/0').get()).exists).toBe(false); expect((await fixtures.database.collection('packs/' + pack.id + '/files').get()).docs.map(file => Number(file.id)).sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11]);
  await page.unrouteAll({ behavior: 'wait' }); await page.reload(); await expect(job).toBeVisible(); await expect(page.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0);
  const other = await fixtures.seedAccount('S4 pending unrelated member'), context = await browser.newContext(), otherPage = await context.newPage();
  try {
    await loginSpark(otherPage, other.email, pack.url); await expect(otherPage.getByRole('heading', { name: 'Skill pack not found', exact: true })).toBeVisible(); await expect(otherPage.getByText('Synthetic S3 saved notes', { exact: true })).toHaveCount(0); await expect(otherPage.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0);
    await otherPage.goto('/packs'); await expect(otherPage.getByRole('heading', { name: 'Community workspace', exact: true })).toBeVisible(); await expect(otherPage.locator('.pending-operation').filter({ hasText: pack.id })).toHaveCount(0);
    await page.goto('/packs'); const ownJob = page.locator('.pending-operation').filter({ hasText: pack.id }); await expect(ownJob).toBeVisible(); await ownJob.getByRole('button', { name: 'Continue cleanup', exact: true }).click(); await expect(ownJob).toHaveCount(0); await gone(pack.id); expect((await fixtures.database.doc('sparkOperations/pack-' + pack.id).get()).get('status')).toBe('done');
  } finally { await context.close(); }
});
test('S4 administrators can resume a member deletion after the initiating browser has closed', async ({ page, browser }) => {
  const { pack } = await packFixture(page); await page.route('**/documents:commit?**', route => hasPath(route.request(), 'packs/' + pack.id + '/groups/0') ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S4 first group cleanup failure' } }) }) : route.continue());
  await permanent(await openDelete(page)); await expect(page.locator('.pending-operation').filter({ hasText: pack.id })).toBeVisible(); await page.unrouteAll({ behavior: 'wait' }); await page.close();
  const administrator = await fixtures.seedAccount('S4 cleanup administrator', 'admin'), context = await browser.newContext(), adminPage = await context.newPage();
  try { await loginSpark(adminPage, administrator.email); await expect(adminPage.getByRole('heading', { name: 'Pending operations', exact: true })).toBeVisible(); const job = adminPage.locator('.pending-operation').filter({ hasText: pack.id }); await job.getByRole('button', { name: 'Continue cleanup', exact: true }).click(); await expect(job).toHaveCount(0); await gone(pack.id); }
  finally { await context.close(); }
});
test('S4 interrupted category migration locks both categories, blocks a prepared save and preserves every pack for continuation', async ({ page, browser }) => {
  const f = await adminFixture(page, 2), context = await browser.newContext(), memberPage = await context.newPage(), title = 'S4 blocked new save ' + randomUUID();
  try {
    await loginSpark(memberPage, f.member.email, '/packs/new'); await expect(memberPage.getByLabel('Title', { exact: true })).toBeVisible(); await memberPage.getByLabel('Title', { exact: true }).fill(title); await memberPage.getByLabel('Category', { exact: true }).selectOption(f.source.id); await memberPage.getByLabel('Notes', { exact: true }).fill('S4 prepared before category lock'); await memberPage.getByLabel('EEG Excel', { exact: true }).setInputFiles(s3EegFile()); await expect(memberPage.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
    await page.route('**/documents:commit?**', route => f.packs.some(pack => hasPath(route.request(), 'packs/' + pack.id)) ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S4 migration failure' } }) }) : route.continue());
    const dialog = await categoryDialog(page, f.source.name, 'Delete category'); await dialog.getByLabel('Move skill packs to', { exact: true }).selectOption(f.target.id); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Delete category', exact: true }).click();
    const job = page.locator('.pending-operation').filter({ hasText: f.source.id }); await expect(job).toBeVisible(); expect((await fixtures.database.doc('categories/' + f.source.id).get()).get('status')).toBe('migrating'); expect((await fixtures.database.doc('categories/' + f.target.id).get()).get('status')).toBe('locked'); await expect(categoryRow(page, f.source.name).getByRole('button', { name: 'Rename', exact: true })).toBeDisabled(); await expect(categoryRow(page, f.target.name).getByRole('button', { name: 'Delete category', exact: true })).toBeDisabled();
    await memberPage.getByRole('button', { name: 'Save skill pack', exact: true }).click(); await expect(memberPage.getByRole('alert')).toContainText(/category|Category/); await expect(memberPage.getByLabel('Title', { exact: true })).toHaveValue(title); expect((await fixtures.database.collection('packs').where('title', '==', title).get()).empty).toBe(true);
    for (const pack of f.packs) { expect((await fixtures.database.doc('packs/' + pack.id).get()).get('categoryId')).toBe(f.source.id); for (const original of (await fixtures.database.collection('packs/' + pack.id + '/files').get()).docs) expect(original.get('bytes')).toEqual(pack.files[Number(original.id)].buffer); }
    await page.unrouteAll({ behavior: 'wait' }); await page.reload(); await expect(job).toBeVisible(); await job.getByRole('button', { name: 'Continue cleanup', exact: true }).click(); await expect(job).toHaveCount(0); expect((await fixtures.database.doc('categories/' + f.source.id).get()).exists).toBe(false); expect((await fixtures.database.doc('categories/' + f.target.id).get()).get('status')).toBe('active');
    for (const pack of f.packs) { expect((await fixtures.database.doc('packs/' + pack.id).get()).get('categoryId')).toBe(f.target.id); expect((await fixtures.database.doc('packs/' + pack.id).get()).get('version')).toBe(1); }
    await memberPage.goto(f.packs[0].url); await expect(memberPage.getByText(f.target.name, { exact: true })).toBeVisible(); expect(await downloadSparkOriginal(memberPage, 'original.xlsx')).toEqual(s3Excel);
  } finally { await context.close(); }
});

// Additional regression after the initial missing-UI red: a display-name change
// must not change confirmation identity or make a completed deletion reusable.
test('S4 an empty renamed category deletes by its stable ID and both names can be recreated with fresh IDs', async ({ page }) => {
  const f = await adminFixture(page, 0), renamed = f.source.name + ' renamed';
  let dialog = await categoryDialog(page, f.source.name, 'Rename'); await dialog.getByLabel('Category name', { exact: true }).fill(renamed); await dialog.getByRole('button', { name: 'Save name', exact: true }).click(); await expect(categoryRow(page, renamed)).toBeVisible();
  expect((await fixtures.database.doc('categories/' + f.source.id).get()).get('name')).toBe(renamed);
  dialog = await categoryDialog(page, renamed, 'Delete category'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Delete category', exact: true }).click(); await expect(categoryRow(page, renamed)).toHaveCount(0); expect((await fixtures.database.doc('categories/' + f.source.id).get()).exists).toBe(false); expect((await fixtures.database.doc('sparkOperations/category-' + f.source.id).get()).get('status')).toBe('done');
  try {
    for (const name of [f.source.name, renamed]) {
      await page.getByLabel('New category', { exact: true }).fill(name); await page.getByRole('button', { name: 'Add category', exact: true }).click(); await expect(categoryRow(page, name)).toBeVisible();
      const saved = await fixtures.database.collection('categories').where('name', '==', name).get(); expect(saved.docs).toHaveLength(1); expect(saved.docs[0].id).not.toBe(f.source.id); expect(saved.docs[0].get('status')).toBe('active');
    }
    expect((await fixtures.database.doc('sparkOperations/category-' + f.source.id).get()).get('status')).toBe('done');
  } finally {
    // These two UI-created categories belong to this exact synthetic actor.
    const created = await fixtures.database.collection('categories').where('createdBy', '==', f.administrator.uid).get();
    for (const category of created.docs.filter(saved => [f.source.name, renamed].includes(saved.get('name')))) { await fixtures.database.doc('categoryKeys/' + String(category.get('name')).toLowerCase()).delete(); await fixtures.database.doc('categoryStats/' + category.id).delete(); await category.ref.delete(); }
  }
});

// Additional deletion-state regression: an already-open viewer must update
// from the real database without refreshing or navigating the document.
test('S4 another member already viewing a deleted pack immediately loses its displayed notes and download controls', async ({ page, browser }) => {
  const { pack } = await packFixture(page), viewer = await fixtures.seedAccount('S4 live deletion viewer'), context = await browser.newContext(), viewerPage = await context.newPage();
  try {
    await loginSpark(viewerPage, viewer.email, pack.url); await expect(viewerPage.getByRole('heading', { name: pack.title, exact: true })).toBeVisible(); await expect(viewerPage.getByText('Synthetic S3 saved notes', { exact: true })).toBeVisible(); await expect(viewerPage.getByRole('button', { name: 'Download ZIP', exact: true })).toBeEnabled(); await expect(viewerPage.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(3);
    const navigations: string[] = []; viewerPage.on('request', request => { if (request.isNavigationRequest() && request.frame() === viewerPage.mainFrame()) navigations.push(request.url()); });
    await permanent(await openDelete(page)); await expect(page.getByRole('heading', { name: 'Skill pack deleted', exact: true })).toBeVisible(); await gone(pack.id);
    await expect(viewerPage.getByRole('heading', { name: 'Skill pack not found', exact: true })).toBeVisible(); await expect(viewerPage.getByRole('heading', { name: pack.title, exact: true })).toHaveCount(0); await expect(viewerPage.getByText('Synthetic S3 saved notes', { exact: true })).toHaveCount(0);
    await expect(viewerPage.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0); await expect(viewerPage.getByRole('button', { name: 'Download ZIP', exact: true })).toHaveCount(0); await expect(viewerPage.getByRole('button', { name: 'Download PNG', exact: true })).toHaveCount(0); await expect(viewerPage).toHaveURL(new RegExp('/packs/' + pack.id + '$')); expect(navigations).toEqual([]);
  } finally { await context.close(); }
});
