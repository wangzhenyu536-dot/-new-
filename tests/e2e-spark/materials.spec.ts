import { expect, test, type Download, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { workbook } from '../fixtures/workbooks.mjs';

const projectId = 'demo-evertrace-spark-test';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:29099') throw new Error('S2 browser tests require the isolated Spark emulators.');
const trusted = initializeApp({ projectId }, 'spark-s2-materials-' + randomUUID());
const database = getFirestore(trusted), identity = getAuth(trusted);
const password = 'Evertrace-test-2026!';
const accountIds = new Set<string>(), categoryIds = new Set<string>();
const imageBytes = await readFile(new URL('../../apps/web/public/samples/synthetic-image.png', import.meta.url));
const excelBytes = Buffer.from(await workbook());
const textBytes = Buffer.from('\ufeff合成 TXT <b>plain original text</b>\r\n第二行');
const notes = 'Synthetic browser notes <script>alert(1)</script>\nOriginal notes stay readable.';
const commitUrl = /\/documents:commit(?:\?.*)?$/;
test.use({ reducedMotion: 'reduce' });
test.setTimeout(35000);
type Upload = { name: string; mimeType: string; buffer: Buffer };
const eeg = (name = 'synthetic-original.xlsx', buffer = excelBytes): Upload => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
const text = (name = 'original-notes.txt', buffer = textBytes): Upload => ({ name, mimeType: 'text/plain', buffer });
const image = (name = 'synthetic-original.png', buffer = imageBytes): Upload => ({ name, mimeType: 'image/png', buffer });
const titleFor = (scenario: string) => 'S2 browser ' + scenario + ' ' + randomUUID();
function packCommit(request: Request) { return request.url().includes(projectId) && commitUrl.test(request.url()) && (request.postData() || '').includes('/documents/packs/'); }
async function seedAccount(name = 'S2 material author') {
  const email = `s2-materials-${randomUUID()}@example.test`, user = await identity.createUser({ email, password });
  accountIds.add(user.uid);
  await database.doc('users/' + user.uid).set({ uid: user.uid, email, displayName: name, role: 'member' });
  return { uid: user.uid, email };
}
async function seedCategory(uid: string) {
  const name = 'S2 category ' + randomUUID(), id = name.toLowerCase();
  categoryIds.add(id);
  await database.doc('categories/' + id).set({ name, status: 'active', createdBy: uid, createdAt: Timestamp.now() });
  return { id, name };
}
async function login(page: Page, email: string, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function form(page: Page, scenario: string) {
  const user = await seedAccount(), category = await seedCategory(user.uid), title = titleFor(scenario);
  await login(page, user.email, '/packs/new');
  // Before S2 this succeeds at authentication and then fails on the genuine upcoming page.
  await expect(page.getByRole('heading', { name: 'Create a skill pack', exact: true })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await expect(page.getByLabel('Category', { exact: true })).toBeEnabled();
  await page.getByLabel('Category', { exact: true }).selectOption(category.id);
  return { user, category, title };
}
async function selectEeg(page: Page, files: Upload | Upload[] = eeg()) {
  await page.getByLabel('EEG Excel', { exact: true }).setInputFiles(files);
  await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save skill pack', exact: true })).toBeEnabled();
}
async function save(page: Page, title: string) {
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
  await expect(page).toHaveURL(/\/packs\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function countPacks(title: string) { return (await database.collection('packs').where('title', '==', title).get()).size; }
async function downloadBytes(download: Download) { const path = await download.path(); expect(path).not.toBeNull(); return readFile(path!); }
async function original(page: Page, name: string, clickDelay = 0) {
  const section = page.locator('.stored-material').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const waiting = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download original', exact: true }).click({ delay: clickDelay });
  const download = await waiting;
  expect(download.suggestedFilename()).toBe(name);
  return downloadBytes(download);
}
function watchServices(page: Page) {
  const forbidden: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^(?:[^.]+\.)*(?:cloudfunctions\.net|firebasestorage\.googleapis\.com|storage\.googleapis\.com)$/.test(url.hostname)
      || ['5001', '9199', '15001', '19199', '9099', '8080'].includes(url.port)) forbidden.push(request.url());
  });
  return forbidden;
}
test.afterAll(async () => {
  if (trusted.options.projectId !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090') throw new Error('Refusing cleanup outside the isolated S2 project.');
  // Delete only data owned by this file's synthetic accounts, never another test or preview.
  const packs = await database.collection('packs').get();
  for (const pack of packs.docs) if (accountIds.has(pack.get('ownerId'))) await database.recursiveDelete(pack.ref);
  for (const id of categoryIds) await database.doc('categories/' + id).delete();
  for (const uid of accountIds) { await database.doc('users/' + uid).delete(); await identity.deleteUser(uid); }
  await deleteApp(trusted);
});

test('S2 notes plus Excel and image save through Spark, refresh, list and preserve both original files', async ({ page }) => {
  const forbidden = watchServices(page), f = await form(page, 'notes-image');
  const addedName = 'S2 inline ' + randomUUID(); categoryIds.add(addedName.toLowerCase());
  await page.getByLabel('New category', { exact: true }).fill(addedName);
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.getByText('Category created and selected.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue(addedName.toLowerCase());
  expect((await database.doc('categories/' + addedName.toLowerCase()).get()).get('createdBy')).toBe(f.user.uid);
  await page.getByLabel('Notes', { exact: true }).fill(notes);
  await selectEeg(page);
  await page.getByLabel('Images', { exact: true }).setInputFiles(image());
  await expect(page.getByRole('img', { name: 'synthetic-original.png', exact: true })).toBeVisible();
  await save(page, f.title);
  await expect(page.getByText(notes, { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'synthetic-original.png', exact: true })).toBeVisible();
  expect(await original(page, 'synthetic-original.xlsx')).toEqual(excelBytes);
  expect(await original(page, 'synthetic-original.png')).toEqual(imageBytes);
  await page.reload(); await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Browse skill packs', exact: false }).click();
  await expect(page.locator('.pack-list a').filter({ hasText: f.title })).toHaveCount(1);
  expect(await countPacks(f.title)).toBe(1);
  expect(forbidden).toEqual([]);
});
test('S2 TXT without notes satisfies text requirements and retains the original UTF-8 BOM and line endings', async ({ page }) => {
  const f = await form(page, 'txt-only');
  await page.getByLabel('Text file', { exact: true }).setInputFiles(text()); await selectEeg(page);
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('');
  await save(page, f.title);
  await expect(page.getByText('合成 TXT <b>plain original text</b>\n第二行', { exact: true })).toBeVisible();
  expect(await original(page, 'original-notes.txt')).toEqual(textBytes);
  expect(await original(page, 'synthetic-original.xlsx')).toEqual(excelBytes);
});
test('S2 a second account views text, image and exact waveform samples and downloads every original after sign-in', async ({ page, browser }) => {
  const f = await form(page, 'shared');
  await page.getByLabel('Notes', { exact: true }).fill(notes);
  await page.getByLabel('Text file', { exact: true }).setInputFiles(text());
  await page.getByLabel('Images', { exact: true }).setInputFiles(image()); await selectEeg(page); await save(page, f.title);
  const url = page.url(), user = await seedAccount('S2 second member'), context = await browser.newContext(), other = await context.newPage(), forbidden = watchServices(other);
  try {
    await login(other, user.email, url);
    await expect(other).toHaveURL(url);
    await expect(other.getByRole('heading', { name: f.title, exact: true })).toBeVisible();
    await expect(other.getByText(notes, { exact: true })).toBeVisible();
    await expect(other.getByRole('img', { name: 'synthetic-original.png', exact: true })).toBeVisible();
    const section = other.locator('.stored-material').filter({ has: other.getByRole('heading', { name: 'synthetic-original.xlsx', exact: true }) });
    await expect(section.getByLabel('Visible time range', { exact: true })).toHaveText('0 – 7 ms');
    const plot = section.getByRole('img', { name: 'EEG preview', exact: true }); await plot.scrollIntoViewIfNeeded();
    await expect(plot).toContainText('Device raw values (unitless) · -3 … 4');
    const box = (await plot.boundingBox())!;
    await other.mouse.move(box.x + box.width * (40 + 2.5 / 7 * 710) / 790, box.y + box.height / 2);
    await expect(section.getByLabel('EEG sample', { exact: true })).toHaveText('2.5 ms · 0');
    expect(await original(other, 'synthetic-original.xlsx')).toEqual(excelBytes);
    expect(await original(other, 'original-notes.txt')).toEqual(textBytes);
    expect(await original(other, 'synthetic-original.png')).toEqual(imageBytes);
    await other.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(other).toHaveURL(/\/login/); expect(forbidden).toEqual([]);
  } finally { await context.close(); }
});
test('S2 missing text or a valid Excel cannot publish even when Save is pressed directly', async ({ page }) => {
  const f = await form(page, 'required');
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
  await expect(page.locator('.pack-review .form-issues')).toContainText('Add notes or a valid text file.');
  await expect(page.locator('.pack-review .form-issues')).toContainText('Add a valid EEG Excel.');
  await page.getByLabel('Notes', { exact: true }).fill(notes);
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
  await expect(page.locator('.pack-review .form-issues')).toContainText('Add a valid EEG Excel.');
  expect(await countPacks(f.title)).toBe(0);
});
test('S2 invalid Excel, empty TXT and a forged image are rejected without publishing', async ({ page }) => {
  const f = await form(page, 'invalid');
  await page.getByLabel('Notes', { exact: true }).fill(notes);
  await page.getByLabel('EEG Excel', { exact: true }).setInputFiles(eeg('wrong-columns.xlsx', Buffer.from(await workbook([['timestamp_ms', 'wrong'], [0, 1], [1, 2]]))));
  await expect(page.getByRole('alert').filter({ hasText: 'two column headers' })).toBeVisible();
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click(); expect(await countPacks(f.title)).toBe(0);
  await selectEeg(page);
  await page.getByLabel('Text file', { exact: true }).setInputFiles(text('empty.txt', Buffer.from(' \n\t')));
  await expect(page.getByRole('alert').filter({ hasText: 'only whitespace' })).toBeVisible();
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click(); expect(await countPacks(f.title)).toBe(0);
  await page.getByLabel('Text file', { exact: true }).setInputFiles([]);
  await page.getByLabel('Images', { exact: true }).setInputFiles(image('forged.png', Buffer.from('This is not an image.')));
  await expect(page.getByRole('alert').filter({ hasText: 'real JPEG, PNG or WebP' })).toBeVisible();
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click(); expect(await countPacks(f.title)).toBe(0);
});
test('S2 all twelve small originals save atomically and remain individually downloadable', async ({ page }) => {
  const f = await form(page, 'twelve'), files = Array.from({ length: 11 }, (_, i) => text(`note-${i + 1}.txt`, Buffer.from('Synthetic TXT ' + i)));
  await page.getByLabel('Text file', { exact: true }).setInputFiles(files); await selectEeg(page); await save(page, f.title);
  await expect(page.locator('.stored-material')).toHaveCount(12);
  // Chromium drops the eleventh burst download within one second. Real pointer
  // presses pace this case while preserving all twelve download and byte checks.
  for (const file of files) expect(await original(page, file.name, 200)).toEqual(file.buffer);
  expect(await original(page, 'synthetic-original.xlsx', 200)).toEqual(excelBytes);
});
test('S2 thirteen attachments are refused while the selected files and inputs remain', async ({ page }) => {
  const f = await form(page, 'thirteen');
  await page.getByLabel('Text file', { exact: true }).setInputFiles(Array.from({ length: 12 }, (_, i) => text(`extra-${i}.txt`, Buffer.from('Synthetic ' + i))));
  await selectEeg(page); await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
  await expect(page.locator('.pack-review .form-issues')).toContainText(/12/);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(f.title);
  expect(await page.locator('#pack-text').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(12);
  expect(await countPacks(f.title)).toBe(0);
});
test('S2 a file one byte above 512 KiB is rejected with the Spark limit', async ({ page }) => {
  const f = await form(page, 'single-limit'), oversized = Buffer.alloc(512 * 1024 + 1); imageBytes.copy(oversized);
  await page.getByLabel('Notes', { exact: true }).fill(notes); await selectEeg(page);
  await page.getByLabel('Images', { exact: true }).setInputFiles(image('over-limit.png', oversized));
  await expect(page.getByRole('alert').filter({ hasText: /512\s*(?:KiB|KB)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click(); expect(await countPacks(f.title)).toBe(0);
});
test('S2 six valid 512 KiB images plus an Excel exceed the 3 MiB total and cannot publish', async ({ page }) => {
  const f = await form(page, 'total-limit'), padded = Buffer.alloc(512 * 1024); imageBytes.copy(padded);
  await page.getByLabel('Notes', { exact: true }).fill(notes); await selectEeg(page);
  await page.getByLabel('Images', { exact: true }).setInputFiles(Array.from({ length: 6 }, (_, i) => image(`full-${i}.png`, padded)));
  await expect(page.locator('.attachment-card img')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Save skill pack', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
  await expect(page.locator('.pack-review .form-issues')).toContainText(/3\s*(?:MiB|MB)/);
  expect(await countPacks(f.title)).toBe(0);
});
test('S2 a real Firestore commit failure retains the complete form and a fresh retry saves exactly once', async ({ page }) => {
  const f = await form(page, 'retry');
  await page.getByLabel('Notes', { exact: true }).fill(notes); await page.getByLabel('Text file', { exact: true }).setInputFiles(text()); await selectEeg(page);
  let refused = false;
  await page.route(commitUrl, async route => {
    if (packCommit(route.request())) { refused = true; await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S2 write rejection' } }) }); }
    else await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Could not save|cannot save/ })).toBeVisible();
    expect(refused).toBe(true); expect(await countPacks(f.title)).toBe(0);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(f.title);
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(notes);
    await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
    expect(await page.locator('#pack-text').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('original-notes.txt');
  } finally { await page.unroute(commitUrl); }
  await save(page, f.title); expect(await countPacks(f.title)).toBe(1);
});
test('S2 cancellation during original-byte preparation writes nothing and keeps files available for retry', async ({ page }) => {
  const f = await form(page, 'cancel'); await page.getByLabel('Notes', { exact: true }).fill(notes); await selectEeg(page);
  await page.evaluate(() => {
    const state = { waiting: false, release: () => {} }, original = crypto.subtle.digest.bind(crypto.subtle);
    const gate = new Promise<void>(resolve => { state.release = resolve; });
    (window as unknown as { s2Digest: typeof state }).s2Digest = state;
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => { state.waiting = true; await gate; return original(...args); } });
  });
  await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { s2Digest: { waiting: boolean } }).s2Digest.waiting)).toBe(true);
  await page.getByRole('button', { name: 'Cancel saving', exact: true }).click();
  await page.evaluate(() => (window as unknown as { s2Digest: { release: () => void } }).s2Digest.release());
  await expect(page.getByRole('alert').filter({ hasText: /cancelled/i })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(f.title);
  expect(await countPacks(f.title)).toBe(0);
  expect(await page.locator('#pack-eeg').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('synthetic-original.xlsx');
  await save(page, f.title); expect(await countPacks(f.title)).toBe(1);
});
test('S2 repeated Save clicks lock the form and commit only one complete pack', async ({ page }) => {
  const f = await form(page, 'double-click'); await page.getByLabel('Notes', { exact: true }).fill(notes); await selectEeg(page);
  let count = 0, release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(commitUrl, async route => { if (packCommit(route.request())) { count++; await gate; } await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Save skill pack', exact: true }).dblclick({ force: true });
    await expect.poll(() => count).toBe(1);
    await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel saving', exact: true })).toBeDisabled();
    release(); await expect(page.getByRole('heading', { name: f.title, exact: true })).toBeVisible();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  expect(count).toBe(1); expect(await countPacks(f.title)).toBe(1);
});
test('S2 a lost response after a real successful commit recovers one existing pack without duplicating files', async ({ page }) => {
  const f = await form(page, 'lost-response'); await page.getByLabel('Notes', { exact: true }).fill(notes); await selectEeg(page);
  let lost = false;
  await page.route(commitUrl, async route => { if (!lost && packCommit(route.request())) { lost = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Save skill pack', exact: true }).click();
    // SDK retries may recover transparently; an explicit form retry must also reuse the committed attempt.
    await expect.poll(async () => await page.getByRole('heading', { name: f.title, exact: true }).isVisible() || await page.getByRole('alert').filter({ hasText: /Could not save|cannot save/ }).isVisible(), { timeout: 15000 }).toBe(true);
  } finally { await page.unroute(commitUrl); }
  expect(lost).toBe(true);
  if (!await page.getByRole('heading', { name: f.title, exact: true }).isVisible()) await save(page, f.title);
  expect(await countPacks(f.title)).toBe(1);
  await expect(page.locator('.stored-material')).toHaveCount(1);
  expect(await original(page, 'synthetic-original.xlsx')).toEqual(excelBytes);
});
test('S2 English and Chinese mobile creation, limits, detail and original download fit without misleading server validation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const f = await form(page, 'mobile');
  await expect(page.locator('.template-notice')).toContainText(/512\s*(?:KiB|KB)/);
  await expect(page.locator('.template-notice')).toContainText(/3\s*(?:MiB|MB)/);
  await page.getByLabel('Notes', { exact: true }).fill(notes); await selectEeg(page);
  await page.getByRole('button', { name: 'Check materials', exact: true }).click();
  await expect(page.locator('.pack-review')).not.toContainText(/server checks|server check/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '创建技能包', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检查材料', exact: true }).click();
  await expect(page.locator('.pack-review')).not.toContainText('服务端');
  await page.screenshot({ path: 'outputs/S2/create-mobile-zh.png', fullPage: true });
  await page.getByRole('button', { name: '保存技能包', exact: true }).click();
  await expect(page.getByRole('heading', { name: f.title, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '脑电预览', exact: true })).toBeVisible();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载原件', exact: true }).click();
  expect(await downloadBytes(await waiting)).toEqual(excelBytes);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'outputs/S2/detail-mobile-zh.png', fullPage: true });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
});
