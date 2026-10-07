import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { workbook } from '../fixtures/workbooks.mjs';

const projectId = 'demo-evertrace-spark-test';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:29099') throw new Error('Detail regressions require isolated Spark emulators.');
const trusted = initializeApp({ projectId }, 'spark-s2-detail-' + randomUUID());
const database = getFirestore(trusted), identity = getAuth(trusted);
const password = 'Evertrace-test-2026!';
const owned = new Set<{ uid: string; categoryId: string; packId: string }>();
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test.use({ reducedMotion: 'reduce' });
test.setTimeout(35000);

async function fixture(bytes: Buffer, name: string, missingFile = false) {
  const email = `s2-detail-${randomUUID()}@example.test`, user = await identity.createUser({ email, password });
  const categoryId = 's2 detail ' + randomUUID(), packId = randomUUID(), title = 'S2 detail ' + randomUUID();
  owned.add({ uid: user.uid, categoryId, packId });
  const meta = { kind: 'eeg', name, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: bytes.length, sha256: digest(bytes) };
  const original = { slot: '0', version: 1, ...meta, bytes };
  const batch = database.batch();
  batch.set(database.doc('users/' + user.uid), { uid: user.uid, email, displayName: 'S2 detail member', role: 'member' });
  batch.set(database.doc('categories/' + categoryId), { name: categoryId, status: 'active', createdBy: user.uid, createdAt: Timestamp.now() });
  batch.set(database.doc('categoryKeys/' + categoryId.toLowerCase()), { categoryId });
  batch.set(database.doc('categoryStats/' + categoryId), { packCount: 1, revision: 1, packId, operationId: digest(Buffer.from(title + meta.sha256)), kind: 'createPack', updatedAt: Timestamp.now() });
  batch.set(database.doc('packs/' + packId), { title, titleSearch: title.toLowerCase(), textContent: 'Synthetic detail failure fixture.', ownerId: user.uid, ownerName: 'S2 detail member', categoryId, version: 1, status: 'ready', totalBytes: bytes.length, textFileCount: 0, imageCount: 0, eegCount: 1, submissionHash: digest(Buffer.from(title + meta.sha256)), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  batch.set(database.doc(`packs/${packId}/groups/0`), { version: 1, slots: ['0'], totalBytes: bytes.length, textCount: 0, imageCount: 0, eegCount: 1, files: { '0': meta } });
  batch.set(database.doc(`packs/${packId}/groups/1`), { version: 1, slots: [], totalBytes: 0, textCount: 0, imageCount: 0, eegCount: 0, files: {} });
  if (!missingFile) batch.set(database.doc(`packs/${packId}/files/0`), original);
  await batch.commit();
  return { email, packId, title, name, original };
}
async function openDetail(page: Page, saved: Awaited<ReturnType<typeof fixture>>) {
  await page.goto('/packs/' + saved.packId);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(saved.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: saved.title, exact: true })).toBeVisible();
  return page.locator('.stored-material').filter({ has: page.getByRole('heading', { name: saved.name, exact: true }) });
}
test.afterAll(async () => {
  if (trusted.options.projectId !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:29099') throw new Error('Refusing detail fixture cleanup outside isolated Spark emulators.');
  // Exact IDs from this file only; no collection-wide cleanup or preview data.
  for (const saved of owned) {
    await database.recursiveDelete(database.doc('packs/' + saved.packId));
    await database.doc('categories/' + saved.categoryId).delete();
    await database.doc('categoryKeys/' + saved.categoryId.toLowerCase()).delete();
    await database.doc('categoryStats/' + saved.categoryId).delete();
    await database.doc('sparkOperations/category-' + saved.categoryId).delete();
    await database.doc('sparkOperations/pack-' + saved.packId).delete();
    await database.doc('users/' + saved.uid).delete();
    await identity.deleteUser(saved.uid);
  }
  await deleteApp(trusted);
});

test('S2 matching original hash and metadata do not turn unreadable Excel into a successful preview or download', async ({ page }) => {
  const bytes = Buffer.from('Synthetic fixture: intact stored bytes, but not an XLSX workbook.\n');
  const saved = await fixture(bytes, 'unreadable-original.xlsx');
  const stored = (await database.doc(`packs/${saved.packId}/files/0`).get()).data()!;
  expect(stored.bytes).toEqual(bytes); expect(stored.size).toBe(bytes.length); expect(stored.sha256).toBe(digest(bytes));
  expect((await database.doc(`packs/${saved.packId}/groups/0`).get()).get('files.0.sha256')).toBe(stored.sha256);
  let parses = 0;
  page.on('worker', worker => { if (worker.url().includes('eeg.worker')) parses++; });
  const section = await openDetail(page, saved);
  const error = section.getByRole('alert');
  await expect(error).toContainText('The file is not a supported, intact XLSX workbook.');
  await expect(section.getByRole('button', { name: 'Download original', exact: true })).toBeDisabled();
  await expect(section.getByRole('img', { name: 'EEG preview', exact: true })).toHaveCount(0);
  expect(parses).toBe(1);
  await section.getByRole('button', { name: 'Retry file', exact: true }).click();
  await expect.poll(() => parses).toBe(2);
  await expect(error).toContainText('The file is not a supported, intact XLSX workbook.');
  await expect(section.getByRole('button', { name: 'Download original', exact: true })).toBeDisabled();
  await expect(section.getByRole('img', { name: 'EEG preview', exact: true })).toHaveCount(0);
  expect((await database.doc(`packs/${saved.packId}/files/0`).get()).get('bytes')).toEqual(bytes);
});

test('S2 a missing original fails explicitly and retries the restored original into a real preview and exact-byte download', async ({ page }) => {
  const bytes = Buffer.from(await workbook()), saved = await fixture(bytes, 'restored-original.xlsx', true);
  const section = await openDetail(page, saved);
  await expect(section.getByRole('alert')).toHaveText('Could not load this file. Try again.Retry file');
  await expect(section.getByRole('button', { name: 'Download original', exact: true })).toBeDisabled();
  await expect(section.getByRole('img', { name: 'EEG preview', exact: true })).toHaveCount(0);
  expect((await database.doc(`packs/${saved.packId}/files/0`).get()).exists).toBe(false);
  // Restore only this synthetic missing document, preserving its manifest and version.
  await database.doc(`packs/${saved.packId}/files/0`).set(saved.original);
  await section.getByRole('button', { name: 'Retry file', exact: true }).click();
  await expect(section.getByRole('img', { name: 'EEG preview', exact: true })).toBeVisible();
  await expect(section.getByLabel('Visible time range', { exact: true })).toHaveText('0 – 7 ms');
  await expect(section.getByRole('alert')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download original', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(saved.name);
  const path = await download.path(); expect(path).not.toBeNull();
  expect(await readFile(path!)).toEqual(bytes);
  expect((await database.doc('packs/' + saved.packId).get()).get('version')).toBe(1);
});
