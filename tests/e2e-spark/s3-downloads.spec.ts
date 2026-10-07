import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { Timestamp } from 'firebase-admin/firestore';
import { workbook } from '../fixtures/workbooks.mjs';
import { loginSpark, makeSparkBrowserFixtures, s3TextFile, s3ImageFile, s3EegFile, watchSparkServices } from '../browser/spark-s3';

const fixtures = makeSparkBrowserFixtures('s3-exports');
test.use({ reducedMotion: 'reduce' });
test.setTimeout(35000);
test.afterAll(() => fixtures.cleanup());
async function fixture(page: Page) {
  const account = await fixtures.seedAccount(), category = await fixtures.seedCategory(account.uid), notes = 'Synthetic export notes 原文 <b>plain text</b>\n';
  const rows = Array.from({ length: 41 }, (_, i) => [i * 2.5 + Math.floor(i / 8), i === 0 ? -100 : i === 40 ? 800 : i]);
  const excel = Buffer.from(await workbook([['timestamp_ms', 'value'], ...rows])), other = Buffer.from(await workbook([['timestamp_ms', 'value'], ...rows.map(([time, value]) => [time, -value])]));
  const files = [s3TextFile('same.txt'), s3TextFile('same.txt', Buffer.from('Second TXT 原文\n')), s3ImageFile(), s3EegFile('same.xlsx', excel), s3EegFile('same.xlsx', other)];
  const pack = await fixtures.seedPack(account, 'S3 / synthetic export ' + randomUUID(), category.id, { files, textContent: notes });
  await loginSpark(page, account.email, pack.url);
  await expect(page.getByRole('heading', { name: pack.title, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'EEG preview', exact: true })).toHaveCount(2);
  await expect(page.locator('.stored-material button').filter({ hasText: /^Download original$/ })).toHaveCount(5);
  const first = page.locator('.stored-material').nth(3), second = page.locator('.stored-material').nth(4);
  return { pack, account, notes, files, excel, other, first, second };
}
async function downloaded(page: Page, button: ReturnType<Page['getByRole']>) {
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  const waiting = page.waitForEvent('download'); await button.click({ delay: 200 });
  const download = await waiting, path = await download.path(); expect(path).not.toBeNull();
  return { bytes: await readFile(path!), name: download.suggestedFilename() };
}
function completeArchive(bytes: Buffer, f: Awaited<ReturnType<typeof fixture>>, language = 'en', version = 1) {
  const entries = unzipSync(bytes), manifest = JSON.parse(strFromU8(entries['manifest.json']));
  expect(manifest).toMatchObject({ packId: f.pack.id, version, language });
  expect(manifest.files).toHaveLength(5); expect(manifest.waveforms).toHaveLength(2); expect(Object.keys(entries)).toHaveLength(10);
  expect(new Set(manifest.files.map((file: { path: string }) => file.path)).size).toBe(5);
  expect(strFromU8(entries['text/content.txt'])).toBe(f.notes);
  for (const file of manifest.files) expect(Buffer.from(entries[file.path])).toEqual(f.files[Number(file.id)].buffer);
  for (const waveform of manifest.waveforms) expect(waveform).toMatchObject({ start: 0, end: 105, sampleCount: 41, width: 2400, height: 1000, timeUnit: 'ms', valueUnit: 'unitless device raw value' });
  return { entries, manifest };
}
async function holdDigest(page: Page) {
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle), state = { waiting: false, completed: 0, release: () => {} };
    const gate = new Promise<void>(resolve => { state.release = resolve; });
    (window as unknown as { s3ExportDigest: typeof state }).s3ExportDigest = state;
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => { state.waiting = true; await gate; const result = await original(...args); state.completed++; return result; } });
  });
}
async function releaseDigest(page: Page) { await page.evaluate(() => (window as unknown as { s3ExportDigest: { release: () => void } }).s3ExportDigest.release()); }

test('S3 real PNG and ZIP keep full range after page zoom, duplicate originals, metadata and Spark-only reads', async ({ page }) => {
  const forbidden = watchSparkServices(page), f = await fixture(page);
  await f.first.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await f.first.getByLabel('Window start (ms)', { exact: true }).fill('25'); await f.first.getByLabel('Window end (ms)', { exact: true }).fill('50');
  await expect(f.first.getByLabel('Visible time range', { exact: true })).toHaveText('25 – 50 ms');
  const png = await downloaded(page, f.first.getByRole('button', { name: 'Download PNG', exact: true }));
  expect(png.name).toBe('same.png'); expect(await sharp(png.bytes).metadata()).toMatchObject({ width: 2400, height: 1000, format: 'png' });
  const endpoint = await sharp(png.bytes).extract({ left: 2275, top: 155, width: 10, height: 10 }).removeAlpha().raw().toBuffer();
  expect([...endpoint].filter(value => value < 60).length).toBeGreaterThan(5);
  const original = await downloaded(page, f.first.getByRole('button', { name: 'Download original', exact: true })); expect(original.bytes).toEqual(f.excel);
  const archive = await downloaded(page, page.getByRole('button', { name: 'Download ZIP', exact: true })); expect(archive.name).not.toMatch(/[/\\]/);
  const { entries, manifest } = completeArchive(archive.bytes, f);
  expect(strFromU8(entries['README.md'])).toContain('without a physical unit');
  for (const waveform of manifest.waveforms) expect(await sharp(entries[waveform.path]).metadata()).toMatchObject({ width: 2400, height: 1000 });
  expect(forbidden).toEqual([]);
});
test('S3 each separate Excel exports its own original and its own distinct PNG', async ({ page }) => {
  const f = await fixture(page);
  const first = await downloaded(page, f.first.getByRole('button', { name: 'Download PNG', exact: true }));
  const second = await downloaded(page, f.second.getByRole('button', { name: 'Download PNG', exact: true }));
  expect(first.bytes.equals(second.bytes)).toBe(false);
  expect((await downloaded(page, f.second.getByRole('button', { name: 'Download original', exact: true }))).bytes).toEqual(f.other);
});
test('S3 a different member downloads all current original Bytes and waveforms through protected Spark reads', async ({ page, browser }) => {
  const f = await fixture(page), other = await fixtures.seedAccount('S3 export viewer'), context = await browser.newContext(), member = await context.newPage();
  try {
    const forbidden = watchSparkServices(member); await loginSpark(member, other.email, f.pack.url);
    await expect(member.getByRole('heading', { name: f.pack.title, exact: true })).toBeVisible();
    await expect(member.getByRole('link', { name: 'Edit skill pack', exact: true })).toHaveCount(0);
    completeArchive((await downloaded(member, member.getByRole('button', { name: 'Download ZIP', exact: true }))).bytes, f); expect(forbidden).toEqual([]);
  } finally { await context.close(); }
});
test('S3 Chinese mobile exports localized README and unitless metadata while preserving original-language notes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const f = await fixture(page);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  const archive = await downloaded(page, page.getByRole('button', { name: '下载 ZIP', exact: true }));
  const { entries } = completeArchive(archive.bytes, f, 'zh-CN'); expect(strFromU8(entries['README.md'])).toContain('无物理单位');
  const png = await downloaded(page, f.first.getByRole('button', { name: '下载 PNG', exact: true })); expect(await sharp(png.bytes).metadata()).toMatchObject({ width: 2400, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const reason of ['missing', 'corrupt']) test(`S3 a ${reason} original stops ZIP without a partial download and retry reads restored bytes`, async ({ page }) => {
  const f = await fixture(page), file = fixtures.database.doc(`packs/${f.pack.id}/files/0`), saved = (await file.get()).data()!;
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible();
  if (reason === 'missing') await file.delete(); else await file.update({ bytes: Buffer.alloc(f.files[0].buffer.length) });
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await expect(page.locator('.pack-downloads').getByRole('alert')).toContainText('size or checksum'); expect(downloads).toBe(0);
  await file.set(saved);
  completeArchive((await downloaded(page, page.getByRole('button', { name: 'Retry export', exact: true }))).bytes, f);
});
test('S3 a version changed during real PNG encoding prevents delivery and requires reload', async ({ page }) => {
  const f = await fixture(page); await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob, state = { waiting: false, release: () => {} }, gate = new Promise<void>(resolve => { state.release = resolve; });
    (window as unknown as { s3CanvasGate: typeof state }).s3CanvasGate = state;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { state.waiting = true; void gate.then(() => original.call(this, callback, ...args)); };
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { s3CanvasGate: { waiting: boolean } }).s3CanvasGate.waiting)).toBe(true);
    const root = fixtures.database.doc('packs/' + f.pack.id), batch = fixtures.database.batch();
    batch.update(root, { version: 2, updatedAt: Timestamp.now() });
    for (const group of ['0', '1']) batch.update(root.collection('groups').doc(group), { version: 2 });
    for (let slot = 0; slot < f.files.length; slot++) batch.update(root.collection('files').doc(String(slot)), { version: 2 });
    await batch.commit();
  } finally { await page.evaluate(() => (window as unknown as { s3CanvasGate: { release: () => void } }).s3CanvasGate.release()); }
  await expect(page.locator('.pack-downloads').getByRole('alert')).toContainText('changed during export'); expect(downloads).toBe(0);
  await page.getByRole('button', { name: 'Reload skill pack', exact: true }).click();
  await expect(page.getByRole('heading', { name: f.pack.title, exact: true })).toBeVisible();
  completeArchive((await downloaded(page, page.getByRole('button', { name: 'Download ZIP', exact: true }))).bytes, f, 'en', 2);
});
test('S3 a real PNG encoder failure delivers no ZIP and an explicit retry succeeds', async ({ page }) => {
  const f = await fixture(page); await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { s3ToBlob: typeof HTMLCanvasElement.prototype.toBlob }).s3ToBlob = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); }; });
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click(); await expect(page.locator('.pack-downloads').getByRole('alert')).toContainText('Could not export'); expect(downloads).toBe(0);
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = (window as unknown as { s3ToBlob: typeof HTMLCanvasElement.prototype.toBlob }).s3ToBlob; });
  completeArchive((await downloaded(page, page.getByRole('button', { name: 'Retry export', exact: true }))).bytes, f);
});
test('S3 cancel a pending original read promptly and retry creates one complete archive', async ({ page }) => {
  const f = await fixture(page); await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible(); await holdDigest(page);
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { s3ExportDigest: { waiting: boolean } }).s3ExportDigest.waiting)).toBe(true);
    await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
    await expect(page.locator('.pack-downloads').getByRole('alert')).toContainText('Export cancelled.'); expect(downloads).toBe(0);
  } finally { await releaseDigest(page); }
  completeArchive((await downloaded(page, page.getByRole('button', { name: 'Retry export', exact: true }))).bytes, f);
});
test('S3 leaving the detail during a pending export aborts it without a late download', async ({ page }) => {
  await fixture(page); await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible(); await holdDigest(page);
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { s3ExportDigest: { waiting: boolean } }).s3ExportDigest.waiting)).toBe(true);
  await page.getByRole('link', { name: 'Browse skill packs', exact: false }).click();
  await expect(page).toHaveURL(/\/packs$/); await releaseDigest(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { s3ExportDigest: { completed: number } }).s3ExportDigest.completed)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Community workspace', exact: true })).toBeVisible(); expect(downloads).toBe(0);
});
